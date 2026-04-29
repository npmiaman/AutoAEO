"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ConnectPage() {
  const [shop, setShop] = useState("");
  const [loading, setLoading] = useState(false);

  function normalize(input: string): string | null {
    let v = input.trim().toLowerCase();
    v = v.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!v) return null;
    if (!v.includes(".")) v = `${v}.myshopify.com`;
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(v)) return null;
    return v;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalize(shop);
    if (!normalized) {
      toast.error(
        "Enter a valid Shopify domain (e.g. mystore or mystore.myshopify.com).",
      );
      return;
    }
    setLoading(true);
    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(normalized)}`;
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Connect a Shopify store
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You&apos;ll be redirected to Shopify to approve the AutoAEO app.
          AutoAEO needs read/write access to your products, theme, and online
          store content.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Store domain</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shop">Shopify domain</Label>
              <Input
                id="shop"
                placeholder="mystore.myshopify.com"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Either your full <code>*.myshopify.com</code> domain or just the
                handle (we&apos;ll add the rest).
              </p>
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Redirecting…" : "Continue to Shopify"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Don&apos;t have a store yet?</p>
        <p className="mt-1">
          Create a free development store at{" "}
          <a
            href="https://partners.shopify.com/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            partners.shopify.com
          </a>{" "}
          → Stores → Add store → Development store. It has full API access for
          $0 and lets you safely test AutoAEO before pointing it at a live
          store.
        </p>
      </div>
    </div>
  );
}
