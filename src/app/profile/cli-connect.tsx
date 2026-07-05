"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createCliTokenAction } from "./actions";

export function CliConnect() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      setToken(await createCliTokenAction());
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div>
          <h2 className="font-heading text-lg tracking-tight">
            Connect your codebase
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Install Pigeon in your repo — it logs into your account, you pick a
            workspace, and it applies the fixes Pigeon generated for you.
          </p>
        </div>

        <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed">
          <code>{`npm i -g pigeon-aeo
pigeon login     # paste the token below
pigeon link      # pick your workspace
pigeon apply     # write the fixes into your codebase`}</code>
        </pre>

        {token ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Paste this into <code>pigeon login</code> — it&rsquo;s shown only
              once:
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted/60 px-3 py-2 text-xs">
                {token}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(token);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={generate} disabled={loading}>
            {loading ? "Generating…" : "Generate CLI token"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
