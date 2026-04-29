"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  applyApprovedAction,
  approveAllPendingAction,
  rollbackRunAction,
} from "@/app/shops/[shopId]/actions";

interface Counts {
  pending: number;
  approved: number;
  rejected: number;
  applied: number;
  failed: number;
  rolledBack: number;
}

export function RunActions({
  runId,
  status,
  counts,
}: {
  runId: string;
  status: string;
  counts: Counts;
}) {
  const [pending, startTransition] = useTransition();

  const isApplied = counts.applied > 0;
  const reviewLocked = isApplied || status === "applying";

  function approveAll() {
    startTransition(async () => {
      try {
        await approveAllPendingAction(runId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Approve all failed");
      }
    });
  }

  function apply() {
    startTransition(async () => {
      try {
        await applyApprovedAction(runId);
        toast.success("Changes applied to your store.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Apply failed");
      }
    });
  }

  function rollback() {
    if (
      !confirm(
        "Roll back every applied change in this run? This restores the prior state of each affected file/page on your live store.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await rollbackRunAction(runId);
        toast.success("Rolled back.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Rollback failed");
      }
    });
  }

  if (reviewLocked) {
    return (
      <div className="flex gap-2">
        <Button variant="outline" disabled>
          Applied
        </Button>
        <Button variant="destructive" disabled={pending} onClick={rollback}>
          {pending ? "Rolling back…" : "Roll back this run"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        disabled={pending || counts.pending === 0}
        onClick={approveAll}
      >
        Approve all ({counts.pending})
      </Button>
      <Button
        disabled={pending || counts.approved === 0}
        onClick={apply}
      >
        {pending ? "Applying…" : `Apply approved (${counts.approved})`}
      </Button>
    </div>
  );
}
