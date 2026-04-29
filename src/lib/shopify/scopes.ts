// Scopes the AutoAEO app requests at install time.
// These cover catalog edits, theme writes (sections, llms.txt, snippets),
// page/blog content, files, and metaobjects/metafields for schema + machine layer.

export const SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_product_listings",
  "read_themes",
  "write_themes",
  "read_content",
  "write_content",
  "read_online_store_pages",
  "write_online_store_pages",
  "read_online_store_navigation",
  "write_online_store_navigation",
  "read_files",
  "write_files",
  "read_metaobjects",
  "write_metaobjects",
  "read_locations",
  "read_shop_locales",
  "read_translations",
] as const;

export const SHOPIFY_SCOPE_STRING = SHOPIFY_SCOPES.join(",");
