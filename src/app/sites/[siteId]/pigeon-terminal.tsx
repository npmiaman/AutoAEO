"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Line {
  message: string;
  kind: "start" | "info" | "done" | "error";
  at: number;
}

const DOT: Record<Line["kind"], string> = {
  start: "text-sky-400",
  info: "text-neutral-300",
  done: "text-emerald-400",
  error: "text-red-400",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const dayKey = (at: number) => {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
};
const dayLabel = (at: number) => {
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} (UTC)`;
};

// A fixed-size terminal at the top of the dashboard streaming what Pigeon is
// doing — the agent works continuously, and every action it takes is appended
// here as persistent history (grouped by day, scroll for older).
export function PigeonTerminal({
  siteId,
  siteName,
  initialLines,
  initialScanning,
}: {
  siteId: string;
  siteName: string;
  initialLines: Line[];
  initialScanning: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [scanning, setScanning] = useState(initialScanning);
  const [limit, setLimit] = useState(60);
  const [hasMore, setHasMore] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasScanning = useRef(initialScanning);
  const lastAt = lines[lines.length - 1]?.at ?? 0;

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/sites/${siteId}/activity?limit=${limit}`, {
          cache: "no-store",
        });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as {
          lines: Line[];
          scanning: boolean;
          hasMore: boolean;
        };
        setLines(data.lines);
        setScanning(data.scanning);
        setHasMore(data.hasMore);
        if (wasScanning.current && !data.scanning) router.refresh();
        wasScanning.current = data.scanning;
      } catch {
        /* keep last state */
      }
    }
    poll();
    const id = setInterval(poll, scanning ? 2500 : 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [siteId, scanning, limit, router]);

  // Auto-scroll to the newest line only when new activity appends (not when
  // older history is loaded above).
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [lastAt, scanning]);

  // Build a flat render list with day separators.
  const rows: Array<{ sep: string } | { line: Line }> = [];
  let lastDay = "";
  for (const l of lines) {
    const k = dayKey(l.at);
    if (k !== lastDay) {
      rows.push({ sep: dayLabel(l.at) });
      lastDay = k;
    }
    rows.push({ line: l });
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-neutral-950 text-neutral-100 shadow-sm">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
        <span className="flex gap-1.5">
          <span className="size-2 rounded-full bg-red-500/80" />
          <span className="size-2 rounded-full bg-amber-500/80" />
          <span className="size-2 rounded-full bg-emerald-500/80" />
        </span>
        <span className="ml-1 font-mono text-[10px] text-neutral-500">
          pigeon — {siteName}
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-neutral-500">
          <span
            className={
              "size-1.5 rounded-full " +
              (scanning ? "animate-pulse bg-sky-400" : "bg-emerald-500/70")
            }
          />
          {scanning ? "working" : "watching 24/7"}
        </span>
      </div>

      <div
        ref={bodyRef}
        className="h-52 space-y-0.5 overflow-y-auto px-4 py-2.5 font-mono text-[11px] leading-relaxed"
      >
        <button
          type="button"
          onClick={() => hasMore && setLimit((l) => l + 60)}
          disabled={!hasMore}
          className="block w-full text-left text-neutral-600 hover:text-neutral-400 disabled:cursor-default disabled:hover:text-neutral-600"
        >
          &gt; {hasMore ? "Load older history" : "— start of history —"}
        </button>

        {rows.length === 0 && (
          <p className="text-neutral-600">
            &gt; No activity yet — run a scan to watch Pigeon work.
          </p>
        )}

        {rows.map((r, i) =>
          "sep" in r ? (
            <div
              key={`sep-${i}`}
              className="flex items-center gap-2 py-1 text-[10px] text-neutral-600"
            >
              <span className="h-px flex-1 bg-white/10" />
              {r.sep}
              <span className="h-px flex-1 bg-white/10" />
            </div>
          ) : (
            <p key={`${r.line.at}-${i}`} className={DOT[r.line.kind]}>
              <span className="select-none text-neutral-600">&gt; </span>
              {r.line.message}
            </p>
          ),
        )}

        {scanning && (
          <p className="text-neutral-400">
            <span className="select-none text-neutral-600">&gt; </span>
            <span className="inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-neutral-300" />
          </p>
        )}
      </div>
    </div>
  );
}
