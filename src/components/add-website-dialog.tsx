"use client";

import { useFormStatus } from "react-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { addWebsite } from "@/app/dashboard/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full rounded-xl" disabled={pending}>
      {pending ? "Adding your site…" : "Add website"}
    </Button>
  );
}

export function AddWebsiteDialog({
  trigger,
}: {
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? <Button>Add a website</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add your website</DialogTitle>
          <DialogDescription>
            Pigeon crawls it, then measures where you show up in AI search.
          </DialogDescription>
        </DialogHeader>
        <form action={addWebsite} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">Website URL</Label>
            <Input
              id="url"
              name="url"
              placeholder="yourbusiness.com"
              required
              autoFocus
              className="h-11 rounded-xl"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">
              What does your business do?{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="description"
              name="description"
              placeholder="e.g. a plumber in Columbus, Ohio"
              className="h-11 rounded-xl"
            />
            <p className="text-xs text-muted-foreground">
              Helps Pigeon generate the searches your buyers actually make.
            </p>
          </div>
          <SubmitButton />
        </form>
      </DialogContent>
    </Dialog>
  );
}
