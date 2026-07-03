"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the scan-status endpoint while a batch scan is running; refreshes the
 * page when it finishes. Rendered only when a job is in flight.
 */
export function ScanPoller({ siteId }: { siteId: string }) {
  const router = useRouter();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    const tick = async () => {
      if (stopped.current) return;
      try {
        const res = await fetch(`/api/sites/${siteId}/scan-status`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { status?: string };
        if (data.status && data.status !== "running") {
          stopped.current = true;
          router.refresh();
          return;
        }
      } catch {
        /* keep polling */
      }
    };
    const id = setInterval(tick, 20_000);
    void tick();
    return () => {
      stopped.current = true;
      clearInterval(id);
    };
  }, [siteId, router]);

  return null;
}
