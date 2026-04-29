"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runPlaybookAction } from "@/app/shops/[shopId]/actions";

export function RunPlaybookButton({
  shopId,
  playbookId,
}: {
  shopId: string;
  playbookId: string;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      try {
        await runPlaybookAction(shopId, playbookId);
      } catch (err) {
        // redirect() throws a special error inside transitions — ignore it.
        if (err instanceof Error && err.message === "NEXT_REDIRECT") return;
        toast.error(err instanceof Error ? err.message : "Run failed");
      }
    });
  }

  return (
    <Button onClick={onClick} disabled={pending} className="self-start">
      {pending ? "Running…" : "Run playbook"}
    </Button>
  );
}
