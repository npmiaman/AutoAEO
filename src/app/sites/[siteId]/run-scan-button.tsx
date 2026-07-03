"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function RunScanButton({
  hasScan,
  scanning,
}: {
  hasScan: boolean;
  scanning: boolean;
}) {
  const { pending } = useFormStatus();
  const busy = pending || scanning;
  return (
    <Button type="submit" disabled={busy} className="rounded-xl">
      {busy ? "Scanning…" : hasScan ? "Re-scan" : "Run visibility scan"}
    </Button>
  );
}
