"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const FOUNDER_EMAIL = "hello@pigeon.dev";

export default function ContactPopup({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="text-center">
        <DialogHeader className="items-center sm:items-center">
          <DialogTitle>Contact</DialogTitle>
        </DialogHeader>
        <a
          href={`mailto:${FOUNDER_EMAIL}`}
          className="font-mono text-base text-foreground underline-offset-4 hover:underline"
        >
          {FOUNDER_EMAIL}
        </a>
      </DialogContent>
    </Dialog>
  );
}
