"use client";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface Opportunity {
  query: string;
  demand: string | null;
}

function Row({ o }: { o: Opportunity }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="truncate">{o.query}</span>
      {o.demand && (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          {o.demand}
        </Badge>
      )}
    </div>
  );
}

// The few highest-opportunity openings inline; "See all" opens the full list in
// a modal so the page itself never grows.
export function TopOpportunities({
  items,
  topN = 5,
}: {
  items: Opportunity[];
  topN?: number;
}) {
  const top = items.slice(0, topN);
  const hasMore = items.length > topN;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {top.map((o) => (
          <Row key={o.query} o={o} />
        ))}
      </div>

      {hasMore && (
        <Dialog>
          <DialogTrigger
            render={
              <button className="cursor-pointer pt-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
                See all {items.length} openings →
              </button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                Where to focus — all {items.length} openings
              </DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {items.map((o) => (
                <Row key={o.query} o={o} />
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
