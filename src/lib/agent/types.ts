import type { ShopifyClient } from "@/lib/shopify/client";

// A single proposed change the agent wants to make.
// Persisted to `change_proposal` after a playbook runs.
export interface ProposedChange {
  kind:
    | "theme_asset" // create/update a file in the theme (e.g. layout/machine.liquid)
    | "theme_template" // create/update a JSON template (e.g. templates/product.machine.json)
    | "robots_txt" // edit robots.txt.liquid
    | "page_create" // create a new Shopify Page
    | "page_update"
    | "product_update" // bulk-update product fields
    | "metafield_set"
    | "snippet_inject"; // inject a snippet into theme.liquid head
  target: string; // identifier (e.g. "templates/product.machine.json")
  title: string;
  description?: string;
  before?: unknown; // current state (for diff)
  after: unknown; // proposed state
}

export interface PlaybookContext {
  shopId: string;
  shopify: ShopifyClient;
}

export interface PlaybookResult {
  summary: string;
  metrics?: Record<string, number | string>;
  proposals: ProposedChange[];
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  run(ctx: PlaybookContext): Promise<PlaybookResult>;
}
