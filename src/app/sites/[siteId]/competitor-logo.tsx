"use client";

import { useState } from "react";

/**
 * Competitor logo. `src` is the logo URL extracted during competitor analysis
 * (server-side). Falls back to a monogram if it's missing or fails to load.
 */
export function CompetitorLogo({
  src,
  name,
  size = 20,
}: {
  src?: string;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
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

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded bg-muted object-contain"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
