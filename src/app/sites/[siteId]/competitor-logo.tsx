"use client";

import { useState } from "react";

/**
 * Competitor logo — tries a real brand logo (Clearbit) keyed by domain, falls
 * back to the favicon service, then to a monogram. All client-side so a broken
 * image degrades gracefully.
 */
export function CompetitorLogo({
  domain,
  name,
  size = 20,
}: {
  domain?: string;
  name: string;
  size?: number;
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(domain ? 0 : 2);

  if (stage === 2 || !domain) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground"
        style={{ width: size, height: size }}
        aria-hidden
      >
        {name.replace(/^https?:\/\//, "").trim()[0]?.toUpperCase() ?? "?"}
      </span>
    );
  }

  const src =
    stage === 0
      ? `https://logo.clearbit.com/${domain}`
      : `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded bg-muted object-contain"
      style={{ width: size, height: size }}
      onError={() => setStage((s) => (s === 0 ? 1 : 2))}
    />
  );
}
