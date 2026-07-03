"use client";

import { CompetitorLogo } from "./competitor-logo";

export interface ChartBar {
  name: string;
  count: number;
  logoUrl?: string;
  isUs: boolean;
}

// Vertical column chart: thick square-edged bars packed close together, logo +
// count on top. No name labels — the name appears in a tooltip on hover. Bars
// baseline-aligned; competitors bright indigo (darken on hover), your bar
// emerald. Scrolls on narrow screens.
export function CompetitorChart({
  bars,
  maxCount,
}: {
  bars: ChartBar[];
  maxCount: number;
}) {
  const MAX_PX = 140;
  return (
    <div className="overflow-x-auto pb-6">
      <div className="flex items-end gap-1.5">
        {bars.map((b, i) => {
          const px = Math.max(8, Math.round((maxCount ? b.count / maxCount : 0) * MAX_PX));
          return (
            <div
              key={`${b.name}-${i}`}
              className="group relative flex w-12 shrink-0 flex-col items-center"
              aria-label={`${b.name}: on ${b.count} of your searches`}
            >
              <span className="mb-1 text-xs font-medium tabular-nums text-muted-foreground">
                {b.count}
              </span>
              <CompetitorLogo src={b.logoUrl} name={b.name} size={22} />
              <div
                className={
                  "mt-1.5 w-8 transition-colors " +
                  (b.isUs
                    ? "bg-emerald-500"
                    : "bg-indigo-400 group-hover:bg-indigo-600")
                }
                style={{ height: px }}
              />
              {/* name appears on hover */}
              <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 max-w-[120px] -translate-x-1/2 truncate whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                {b.isUs ? "You" : b.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
