"use client";

import { CompetitorLogo } from "./competitor-logo";

export interface ChartBar {
  name: string;
  count: number;
  logoUrl?: string;
  isUs: boolean;
}

// Vertical column chart: thick square-edged bars, logo on top of each, count
// above it, name below. Competitor bars shade darker on hover; your bar is
// solid (highlighted). Baseline-aligned like a benchmark chart.
export function CompetitorChart({
  bars,
  maxCount,
}: {
  bars: ChartBar[];
  maxCount: number;
}) {
  const MAX_PX = 150;
  return (
    <div className="flex items-end justify-between gap-2 sm:gap-4">
      {bars.map((b, i) => {
        const px = Math.max(8, Math.round((maxCount ? b.count / maxCount : 0) * MAX_PX));
        return (
          <div
            key={`${b.name}-${i}`}
            className="group flex min-w-0 flex-1 flex-col items-center"
            title={`${b.name}: on ${b.count} of your searches`}
          >
            <span className="mb-1 text-xs font-medium tabular-nums text-muted-foreground">
              {b.count}
            </span>
            <CompetitorLogo src={b.logoUrl} name={b.name} size={22} />
            <div
              className={
                "mt-1.5 w-full max-w-[38px] transition-colors " +
                (b.isUs
                  ? "bg-foreground"
                  : "bg-foreground/65 group-hover:bg-foreground")
              }
              style={{ height: px }}
            />
            <span
              className={
                "mt-2 w-full truncate text-center text-[11px] " +
                (b.isUs
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground")
              }
            >
              {b.isUs ? "You" : b.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
