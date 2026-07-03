import "server-only";
import type {
  Artifact,
  ArtifactSnapshot,
  SiteAdapter,
} from "@/lib/agent/site/adapter";
import type { ResolvedSite } from "../site";

// ─────────────────────────────────────────────────────────────────────
// Agent tools — the flexible, interchangeable capabilities the optimization
// agent composes however it wants. Tools expose CAPABILITIES (read the site,
// recall memory, write any document / schema / field / asset, measure), not
// pre-baked transforms — so the agent decides what to do, and it happens.
//
// Every mutating tool snapshots before it writes and records the mutation on
// the context, so the engine can roll the whole batch back if the change
// doesn't improve visibility. That safety harness is invariant no matter what
// the agent chooses to do.
// ─────────────────────────────────────────────────────────────────────

export interface RecordedMutation {
  artifact: Artifact;
  snapshot: ArtifactSnapshot;
  intent: string; // short descriptor for memory fingerprinting
}

export interface ToolContext {
  site: ResolvedSite;
  adapter: SiteAdapter;
  // Appended to by mutating tools; the engine reverts these in reverse order
  // if the targeted re-measure doesn't show a clean win.
  mutations: RecordedMutation[];
  // Set by the `finish` tool to end the agent loop.
  finished: { done: boolean; summary: string };
}

// JSON Schema (object) describing a tool's arguments, as OpenAI expects.
export type JsonSchema = Record<string, unknown>;

export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Execute the tool. Returns a string result fed back to the model. Never
   *  throws — errors are returned as text so the agent can adapt. */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}
