"use client";

import { CompetitorLogo } from "./competitor-logo";

export interface ChartBar {
  name: string;
  count: number;
  logoUrl?: string;
  isUs: boolean;
}

// Vertical column chart: thick square-edged bars close together, logo + count on
// top of each, name below. Competitors in a bright hue (darken on hover); your
// bar is a distinct colour and highlighted. Scrolls on narrow screens.
export function CompetitorChart({
  bars,
  maxCount,
}: {
  bars: ChartBar[];
  maxCount: number;
}) {
  const MAX_PX = 140;
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex items-end gap-3">
        {bars.map((b, i) => {
          const px = Math.max(8, Math.round((maxCount ? b.count / maxCount : 0) * MAX_PX));
          return (
            <div
              key={`${b.name}-${i}`}
              className="group flex w-16 shrink-0 flex-col items-center"
              title={`${b.name}: on ${b.count} of your searches`}
            >
              <span className="mb-1 text-xs font-medium tabular-nums text-muted-foreground">
                {b.count}
              </span>
              <CompetitorLogo src={b.logoUrl} name={b.name} size={22} />
              <div
                className={
                  "mt-1.5 w-9 transition-colors " +
                  (b.isUs
                    ? "bg-emerald-500"
                    : "bg-indigo-400 group-hover:bg-indigo-600")
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
    </div>
  );
}
