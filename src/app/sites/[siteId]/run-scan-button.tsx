"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function RunScanButton({ hasScan }: { hasScan: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="rounded-xl">
      {pending
        ? "Scanning… (~1 min)"
        : hasScan
          ? "Re-scan"
          : "Run visibility scan"}
    </Button>
  );
}
