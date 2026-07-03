// Scopes the Pigeon app requests at install time.
// These cover catalog edits, theme writes (sections, llms.txt, snippets),
// page/blog/redirect content, files, and metaobjects for schema + machine layer.
//
// Note: pages / blogs / articles / redirects / navigation are all covered by
// read_content / write_content in the current Admin API — the older
// read_online_store_pages / read_online_store_navigation scopes were removed.
// `read_shop_locales` was also removed; basic shop info doesn't require it.

export const SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_themes",
  "write_themes",
  "read_content",
  "write_content",
  "read_files",
  "write_files",
  "read_metaobjects",
  "write_metaobjects",
  "read_locations",
] as const;

export const SHOPIFY_SCOPE_STRING = SHOPIFY_SCOPES.join(",");
