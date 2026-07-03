import "server-only";
import type { EngineQueryResult } from "./types";

// ─────────────────────────────────────────────────────────────────────
// OpenAI Batch API — submit ALL grounded searches as ONE batch job instead of
// N synchronous calls. Each request in the batch is still a complete, dedicated
// `search-preview` call (full attention per query, same as running it alone),
// but the whole set is submitted once, at ~50% cost, on the batch queue.
//
// Trade-off: asynchronous — the job completes in minutes (24h SLA), so the scan
// runs in the background and is finalized when the batch is done.
// ─────────────────────────────────────────────────────────────────────

const MODEL = process.env.OPENAI_SEARCH_MODEL ?? "gpt-4o-mini-search-preview";
const API = "https://api.openai.com/v1";

function auth(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  return `Bearer ${key}`;
}

/** Build the JSONL batch input — one chat-completions request per search. */
function buildJsonl(searches: string[]): string {
  return searches
    .map((query, i) =>
      JSON.stringify({
        custom_id: `q_${i}`,
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model: MODEL,
          web_search_options: {},
          messages: [{ role: "user", content: query }],
        },
      }),
    )
    .join("\n");
}

/** Submit all searches as one batch. Returns the batch id. */
export async function submitSearchBatch(searches: string[]): Promise<string> {
  const jsonl = buildJsonl(searches);

  // 1. Upload the input file (purpose: batch).
  const form = new FormData();
  form.append("purpose", "batch");
  form.append(
    "file",
    new Blob([jsonl], { type: "application/jsonl" }),
    "searches.jsonl",
  );
  const fileRes = await fetch(`${API}/files`, {
    method: "POST",
    headers: { Authorization: auth() },
    body: form,
  });
  if (!fileRes.ok)
    throw new Error(`Batch file upload ${fileRes.status}: ${await fileRes.text()}`);
  const file = (await fileRes.json()) as { id: string };

  // 2. Create the batch job.
  const batchRes = await fetch(`${API}/batches`, {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json" },
    body: JSON.stringify({
      input_file_id: file.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    }),
  });
  if (!batchRes.ok)
    throw new Error(`Batch create ${batchRes.status}: ${await batchRes.text()}`);
  const batch = (await batchRes.json()) as { id: string };
  return batch.id;
}

export type BatchStatus =
  | "running" // validating | in_progress | finalizing
  | "completed"
  | "failed";

interface BatchResult {
  status: BatchStatus;
  results?: EngineQueryResult[]; // aligned to the original searches order
}

interface OutputLine {
  custom_id?: string;
  response?: {
    status_code?: number;
    body?: {
      choices?: Array<{
        message?: {
          content?: string;
          annotations?: Array<{
            type: string;
            url_citation?: { url?: string; title?: string };
          }>;
        };
      }>;
    };
  };
  error?: unknown;
}

/**
 * Check a batch. If completed, download + parse the output into per-search
 * EngineQueryResults (in the original order). If still running, results is null.
 */
export async function retrieveSearchBatch(
  batchId: string,
  searches: string[],
): Promise<BatchResult> {
  const res = await fetch(`${API}/batches/${batchId}`, {
    headers: { Authorization: auth() },
  });
  if (!res.ok) throw new Error(`Batch retrieve ${res.status}: ${await res.text()}`);
  const batch = (await res.json()) as {
    status: string;
    output_file_id?: string | null;
  };

  if (["failed", "expired", "cancelled"].includes(batch.status)) {
    return { status: "failed" };
  }
  if (batch.status !== "completed" || !batch.output_file_id) {
    return { status: "running" };
  }

  // Download + parse the output JSONL.
  const outRes = await fetch(`${API}/files/${batch.output_file_id}/content`, {
    headers: { Authorization: auth() },
  });
  if (!outRes.ok)
    throw new Error(`Batch output ${outRes.status}: ${await outRes.text()}`);
  const text = await outRes.text();

  const byIndex = new Map<number, EngineQueryResult>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: OutputLine;
    try {
      parsed = JSON.parse(line) as OutputLine;
    } catch {
      continue;
    }
    const idx = Number((parsed.custom_id ?? "").replace(/^q_/, ""));
    if (!Number.isInteger(idx)) continue;
    const query = searches[idx] ?? "";
    const msg = parsed.response?.body?.choices?.[0]?.message;
    if (!msg || (parsed.response?.status_code ?? 500) >= 400) {
      byIndex.set(idx, {
        engine: "openai",
        query,
        answerText: "",
        citations: [],
        error: `batch line ${parsed.custom_id} failed`,
      });
      continue;
    }
    const citations = (msg.annotations ?? [])
      .filter((a) => a.type === "url_citation")
      .flatMap((a) => [a.url_citation?.url, a.url_citation?.title])
      .filter((u): u is string => !!u);
    byIndex.set(idx, {
      engine: "openai",
      query,
      answerText: msg.content ?? "",
      citations,
    });
  }

  const results = searches.map(
    (query, i) =>
      byIndex.get(i) ?? {
        engine: "openai",
        query,
        answerText: "",
        citations: [],
        error: "no batch result",
      },
  );
  return { status: "completed", results };
}
