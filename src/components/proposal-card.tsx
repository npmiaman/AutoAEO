"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  approveProposalAction,
  rejectProposalAction,
} from "@/app/shops/[shopId]/actions";

interface Proposal {
  id: string;
  kind: string;
  target: string;
  title: string;
  description: string | null;
  beforeJson: string | null;
  afterJson: string;
  status: string;
  errorMessage: string | null;
}

const KIND_LABEL: Record<string, string> = {
  theme_asset: "Theme asset",
  theme_template: "Theme template",
  robots_txt: "robots.txt",
  page_create: "Online store page",
  page_update: "Page update",
  product_update: "Product update",
  metafield_set: "Metafield",
  snippet_inject: "Snippet inject",
};

const STATUS_BADGE: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pending review", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "secondary" },
  applied: { label: "Applied", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
  rolled_back: { label: "Rolled back", variant: "outline" },
};

export function ProposalCard({
  proposal,
  reviewLocked,
}: {
  proposal: Proposal;
  reviewLocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const before = proposal.beforeJson ? safeParse(proposal.beforeJson) : null;
  const after = safeParse(proposal.afterJson);
  const statusCfg =
    STATUS_BADGE[proposal.status] ?? { label: proposal.status, variant: "outline" as const };

  function approve() {
    startTransition(async () => {
      try {
        await approveProposalAction(proposal.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Approve failed");
      }
    });
  }
  function reject() {
    startTransition(async () => {
      try {
        await rejectProposalAction(proposal.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Reject failed");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              {KIND_LABEL[proposal.kind] ?? proposal.kind}
            </Badge>
            <Badge variant={statusCfg.variant} className="text-[10px]">
              {statusCfg.label}
            </Badge>
            <code className="text-xs text-muted-foreground">
              {proposal.target}
            </code>
          </div>
          <CardTitle className="text-base">{proposal.title}</CardTitle>
          {proposal.description && (
            <p className="text-sm text-muted-foreground">
              {proposal.description}
            </p>
          )}
          {proposal.errorMessage && (
            <p className="text-sm text-destructive">{proposal.errorMessage}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide diff" : "View diff"}
          </Button>
          {!reviewLocked && proposal.status === "pending" && (
            <div className="flex gap-1">
              <Button size="sm" disabled={pending} onClick={approve}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={reject}
              >
                Reject
              </Button>
            </div>
          )}
          {!reviewLocked && proposal.status === "approved" && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={reject}>
              Unapprove
            </Button>
          )}
          {!reviewLocked && proposal.status === "rejected" && (
            <Button size="sm" disabled={pending} onClick={approve}>
              Re-approve
            </Button>
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <DiffView before={before} after={after} />
        </CardContent>
      )}
    </Card>
  );
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function toText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}

function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const beforeText = toText(before);
  const afterText = toText(after);

  if (beforeText === "" && afterText) {
    return (
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
          New file
        </div>
        <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
          <code>{afterText}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
          Before
        </div>
        <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
          <code>{beforeText || "(empty)"}</code>
        </pre>
      </div>
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
          After
        </div>
        <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
          <code>{afterText}</code>
        </pre>
      </div>
    </div>
  );
}
