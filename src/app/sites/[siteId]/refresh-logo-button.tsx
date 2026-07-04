"use client";

import { useFormStatus } from "react-dom";

// Tiny affordance shown only when we couldn't grab our own logo. Re-fetches just
// ours (no rescan) via the refreshLogo server action.
export function RefreshLogoButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
    >
      {pending ? "Fetching your logo…" : "Logo missing? Get my logo →"}
    </button>
  );
}
