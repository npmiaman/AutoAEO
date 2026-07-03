import "server-only";

// ─────────────────────────────────────────────────────────────────────
// Provider-agnostic text generation for the measurement layer.
//
// The rest of AutoAEO is Gemini-centric, but synthetic testing must be able
// to run on OpenAI alone (Gemini gated off). This picks a provider by which
// key is present — OpenAI first — so query generation never hard-depends on
// Google. Kept local to measurement; the wider LLM migration is separate.
// ─────────────────────────────────────────────────────────────────────

export async function generateText(
  prompt: string,
  opts?: { temperature?: number },
): Promise<string> {
  if (process.env.OPENAI_API_KEY) return openaiText(prompt, opts);
  if (process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return geminiText(prompt, opts);
  }
  throw new Error(
    "No LLM configured for query generation. Set OPENAI_API_KEY or GOOGLE_API_KEY.",
  );
}

async function openaiText(
  prompt: string,
  opts?: { temperature?: number },
): Promise<string> {
  const model = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: opts?.temperature ?? 0.7,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

async function geminiText(
  prompt: string,
  opts?: { temperature?: number },
): Promise<string> {
  // Lazy import so a pure-OpenAI setup never loads the Google SDK.
  const { buildChatModel } = await import("@/lib/agent/llm");
  const res = await buildChatModel({ temperature: opts?.temperature }).invoke(
    prompt,
  );
  return typeof res.content === "string"
    ? res.content
    : Array.isArray(res.content)
      ? res.content
          .map((c) => (typeof c === "string" ? c : "text" in c ? c.text : ""))
          .join("")
      : String(res.content);
}
