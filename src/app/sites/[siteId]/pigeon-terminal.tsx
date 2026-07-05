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
  info: "text-muted-foreground",
  done: "text-emerald-400",
  error: "text-red-400",
};

// A live terminal at the top of the dashboard: polls what Pigeon is doing and
// streams it. While a scan runs it keeps polling (and refreshes the page when it
// finishes so the metrics below update too).
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasScanning = useRef(initialScanning);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/sites/${siteId}/activity`, {
          cache: "no-store",
        });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { lines: Line[]; scanning: boolean };
        setLines(data.lines);
        setScanning(data.scanning);
        // Scan just finished → pull fresh metrics into the rest of the page.
        if (wasScanning.current && !data.scanning) router.refresh();
        wasScanning.current = data.scanning;
      } catch {
        /* keep last state */
      }
    }
    poll(); // fill immediately on mount
    // Poll faster while working, slower when idle.
    const id = setInterval(poll, scanning ? 2500 : 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [siteId, scanning, router]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [lines]);

  return (
    <div className="overflow-hidden rounded-xl border bg-neutral-950 text-neutral-100 shadow-sm">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-500/80" />
          <span className="size-2.5 rounded-full bg-amber-500/80" />
          <span className="size-2.5 rounded-full bg-emerald-500/80" />
        </span>
        <span className="ml-1 font-mono text-xs text-neutral-400">
          pigeon — {siteName}
        </span>
        {scanning && (
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-sky-400">
            <span className="size-1.5 animate-pulse rounded-full bg-sky-400" />
            working
          </span>
        )}
      </div>
      <div
        ref={bodyRef}
        className="max-h-52 space-y-1 overflow-y-auto px-4 py-3 font-mono text-[13px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="text-neutral-500">
            &gt; No activity yet — run a scan to watch Pigeon work.
          </p>
        ) : (
          lines.map((l, i) => (
            <p key={`${l.at}-${i}`} className={DOT[l.kind]}>
              <span className="select-none text-neutral-600">&gt; </span>
              {l.message}
            </p>
          ))
        )}
        {scanning && (
          <p className="text-neutral-400">
            <span className="select-none text-neutral-600">&gt; </span>
            <span className="inline-block h-3.5 w-2 translate-y-0.5 animate-pulse bg-neutral-300" />
          </p>
        )}
      </div>
    </div>
  );
}
