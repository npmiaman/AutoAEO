import "server-only";
import { STRATEGY_BRIEF } from "@/lib/agent/strategy";
import type { Diagnosis } from "@/lib/agent/measurement/diagnosis";
import { recentLearnings } from "@/lib/agent/memory";
import type { ResolvedSite } from "./site";
import { buildTools } from "./tools";
import type { RecordedMutation, ToolContext } from "./tools/types";

// ─────────────────────────────────────────────────────────────────────
// The optimization agent. Given the strategy playbook, the latest visibility
// diagnosis, and its own memory, it composes tools freely to improve where the
// site is invisible — then calls `finish`. It doesn't decide keep-vs-rollback;
// the engine does that authoritatively via a before/after re-measure around
// this whole turn. The agent just acts; the harness keeps it safe.
//
// Implemented directly on OpenAI function-calling (no extra framework dep) so
// it runs on the OpenAI-only setup.
// ─────────────────────────────────────────────────────────────────────

const MODEL = process.env.OPENAI_AGENT_MODEL ?? "gpt-4o";
const MAX_STEPS = Number(process.env.LOOP_AGENT_MAX_STEPS ?? 12);

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface AgentRunResult {
  mutations: RecordedMutation[];
  summary: string;
  steps: number;
}

export async function runOptimizationAgent(args: {
  site: ResolvedSite;
  adapter: ResolvedSite["adapter"];
  diagnosis?: Diagnosis;
}): Promise<AgentRunResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set — agent cannot run.");

  const tools = buildTools();
  const ctx: ToolContext = {
    site: args.site,
    adapter: args.adapter,
    mutations: [],
    finished: { done: false, summary: "" },
  };

  const learnings = await recentLearnings(args.site.id, 12);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(args.site, learnings) },
    { role: "user", content: userPrompt(args.site, args.diagnosis) },
  ];

  const toolSpecs = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  let steps = 0;
  for (; steps < MAX_STEPS; steps++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: toolSpecs,
        tool_choice: "auto",
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      throw new Error(`Agent LLM ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
    };
    const msg = json.choices?.[0]?.message;
    if (!msg) break;
    messages.push(msg);

    if (!msg.tool_calls?.length) break; // agent produced a final message

    for (const call of msg.tool_calls) {
      const tool = tools.find((t) => t.name === call.function.name);
      let result: string;
      if (!tool) {
        result = `Unknown tool: ${call.function.name}`;
      } else {
        try {
          const parsed = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
          result = await tool.execute(parsed, ctx);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }

    if (ctx.finished.done) break;
  }

  return {
    mutations: ctx.mutations,
    summary:
      ctx.finished.summary ||
      (ctx.mutations.length
        ? `Applied ${ctx.mutations.length} change(s).`
        : "No changes made."),
    steps,
  };
}

function systemPrompt(
  site: ResolvedSite,
  learnings: Array<{ playbook: string; verdict: string | null; notes: string }>,
): string {
  const memory = learnings.length
    ? learnings
        .map((l) => `- (${l.verdict ?? "?"}) ${l.notes}`)
        .join("\n")
    : "- (no prior attempts recorded)";
  return `You are Pigeon's autonomous optimization agent for the site "${site.name}" (${site.primaryDomain}), platform: ${site.platform}.

Your job: make this site show up more often when people ask AI assistants (ChatGPT etc.) questions in its space, by making real changes to it via your tools. Follow this playbook — recommend/act on the high-impact levers, not folklore:

${STRATEGY_BRIEF}

RULES OF ENGAGEMENT:
- Inspect before acting: use list_resources / get_resource / fetch_public_url.
- ALWAYS recall_memory for an idea before doing it — never repeat a past dead end (verdict "regressed"/"no_change") or redo an existing win.
- Make ONE focused, coherent change per turn (a few related tool calls), targeting a specific gap. Small, attributable changes let the engine measure what worked.
- Only mark up schema for facts actually present on the visible page.
- Prefer high-impact levers (entity/trust, answer-first content, FAQPage schema, crawler access, off-site) over low-impact ones (llms.txt, AI-specific schema).
- When done, call finish with a concise summary. If nothing is worth changing, call finish and say so.

WHAT YOU'VE LEARNED ON THIS SITE:
${memory}

Every change you make is snapshotted and will be automatically reverted by the engine if it doesn't improve visibility — so act decisively, but make changes whose effect can be measured.`;
}

function userPrompt(site: ResolvedSite, diagnosis?: Diagnosis): string {
  if (!diagnosis) {
    return `No diagnosis is available yet for ${site.name}. Inspect the site, form a hypothesis about why it may be under-cited, and make one focused improvement. Then finish.`;
  }
  return `Latest visibility diagnosis for ${site.name}:

WE ALREADY RANK ON:
${diagnosis.rankedOn.map((q) => `- ${q}`).join("\n") || "- (none)"}

WE ARE ABSENT FROM:
${diagnosis.missingOn.map((q) => `- ${q}`).join("\n") || "- (none)"}

WHAT WORKS: ${diagnosis.whatWorks.join(" ") || "n/a"}
WHAT'S MISSING: ${diagnosis.whatsMissing.join(" ") || "n/a"}

RECOMMENDATIONS:
${diagnosis.recommendations
  .map(
    (r, i) =>
      `${i + 1}. [${r.kind}] ${r.action} — targets: ${r.exampleQueries.join(", ")}`,
  )
  .join("\n") || "(none)"}

Pick the single most promising, not-yet-tried improvement and implement it now with your tools. Then finish.`;
}
