import type { StoreProfile } from "./profile";

// ─────────────────────────────────────────────────────────────────────
// Vertical-aware variants of the machine-product Liquid section.
// Each variant emphasizes the high-value attributes for that vertical
// in the order an AI shopping query would care about them.
//
// These are still Liquid templates (rendered by Shopify per request),
// but the structure and headings differ by vertical.
// ─────────────────────────────────────────────────────────────────────

const HEADERS = `**Price:** {% if product.price_min == product.price_max %}{{ product.price | money }}{% else %}{{ product.price_min | money }} – {{ product.price_max | money }}{% endif %}
**Vendor:** {{ product.vendor }}
**Type:** {{ product.type }}
**Available:** {% if product.available %}Yes{% else %}No{% endif %}
**URL:** {{ shop.url }}{{ product.url }}`;

const SUPPLEMENTS_TEMPLATE = `<pre>
# {{ product.title }}

${HEADERS}

## What it is
{{ product.description | strip_html | strip_newlines | truncate: 600 }}

{%- if product.metafields.specs %}

## Specifications
{%- for f in product.metafields.specs %}
- {{ f | first }}: {{ f | last }}
{%- endfor %}
{%- endif %}

{%- if product.metafields.nutrition %}

## Nutrition / ingredients
{%- for f in product.metafields.nutrition %}
- {{ f | first }}: {{ f | last }}
{%- endfor %}
{%- endif %}

## Variants
{%- for v in product.variants %}
- {{ v.title }} — {{ v.price | money }}{% if v.sku != blank %} (SKU: {{ v.sku }}){% endif %}{% unless v.available %} (sold out){% endunless %}
{%- endfor %}
</pre>`;

const APPAREL_TEMPLATE = `<pre>
# {{ product.title }}

${HEADERS}

## Description
{{ product.description | strip_html | strip_newlines | truncate: 600 }}

## Sizes & variants
{%- for v in product.variants %}
- {{ v.title }} — {{ v.price | money }}{% unless v.available %} (sold out){% endunless %}
{%- endfor %}

{%- if product.options.size > 0 %}

## Options
{%- for opt in product.options_with_values %}
- {{ opt.name }}: {{ opt.values | join: ', ' }}
{%- endfor %}
{%- endif %}

{%- if product.metafields.materials %}

## Materials & care
{%- for f in product.metafields.materials %}
- {{ f | first }}: {{ f | last }}
{%- endfor %}
{%- endif %}
</pre>`;

const ELECTRONICS_TEMPLATE = `<pre>
# {{ product.title }}

${HEADERS}

## Specs
{%- if product.metafields.specs %}
{%- for f in product.metafields.specs %}
- {{ f | first }}: {{ f | last }}
{%- endfor %}
{%- endif %}
{%- if product.options.size > 0 %}
{%- for opt in product.options_with_values %}
- {{ opt.name }}: {{ opt.values | join: ', ' }}
{%- endfor %}
{%- endif %}

## Description
{{ product.description | strip_html | strip_newlines | truncate: 800 }}

## Variants & pricing
{%- for v in product.variants %}
- {{ v.title }} — {{ v.price | money }}{% if v.sku != blank %} (SKU: {{ v.sku }}){% endif %}{% unless v.available %} (sold out){% endunless %}
{%- endfor %}
</pre>`;

const SERVICE_TEMPLATE = `<pre>
# {{ product.title }}

**Price:** {% if product.price_min == product.price_max %}{{ product.price | money }}{% else %}from {{ product.price_min | money }}{% endif %}
**Provider:** {{ product.vendor | default: shop.name }}
**URL:** {{ shop.url }}{{ product.url }}

## What's included
{{ product.description | strip_html | strip_newlines | truncate: 800 }}

{%- if product.options.size > 0 %}

## Options
{%- for opt in product.options_with_values %}
- {{ opt.name }}: {{ opt.values | join: ', ' }}
{%- endfor %}
{%- endif %}

## Tiers
{%- for v in product.variants %}
- {{ v.title }} — {{ v.price | money }}
{%- endfor %}
</pre>`;

const FOOD_TEMPLATE = `<pre>
# {{ product.title }}

${HEADERS}

## Description
{{ product.description | strip_html | strip_newlines | truncate: 600 }}

{%- if product.metafields.nutrition %}

## Nutrition & ingredients
{%- for f in product.metafields.nutrition %}
- {{ f | first }}: {{ f | last }}
{%- endfor %}
{%- endif %}

## Sizes
{%- for v in product.variants %}
- {{ v.title }} — {{ v.price | money }}{% unless v.available %} (sold out){% endunless %}
{%- endfor %}
</pre>`;

// Map of vertical → template. 'general' falls back to a balanced default
// near the original Machine Layer template.
const GENERAL_TEMPLATE = `<pre>
# {{ product.title }}

${HEADERS}
{%- if product.tags.size > 0 %}
**Tags:** {{ product.tags | join: ', ' }}
{%- endif %}

## Description
{{ product.description | strip_html | strip_newlines | truncate: 800 }}

{%- if product.options.size > 0 %}

## Options
{%- for opt in product.options_with_values %}
- {{ opt.name }}: {{ opt.values | join: ', ' }}
{%- endfor %}
{%- endif %}

{%- if product.variants.size > 1 %}

## Variants
{%- for v in product.variants %}
- {{ v.title }} — {{ v.price | money }}{% if v.sku != blank %} (SKU: {{ v.sku }}){% endif %}{% unless v.available %} (sold out){% endunless %}
{%- endfor %}
{%- endif %}

{%- if product.metafields.specs %}

## Specifications
{%- for f in product.metafields.specs %}
- {{ f | first }}: {{ f | last }}
{%- endfor %}
{%- endif %}
</pre>`;

const SCHEMA_LD_BLOCK = `

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "{{SCHEMA_TYPE}}",
  "name": {{ product.title | json }},
  "description": {{ product.description | strip_html | json }},
  "image": [{% for img in product.images limit: 5 %}{{ img.src | image_url: width: 1200 | json }}{% unless forloop.last %}, {% endunless %}{% endfor %}],
  "sku": {{ product.selected_or_first_available_variant.sku | json }},
  "brand": { "@type": "Brand", "name": {{ product.vendor | json }} },
  "offers": {
    "@type": "AggregateOffer",
    "priceCurrency": {{ shop.currency | json }},
    "lowPrice": {{ product.price_min | divided_by: 100.0 | json }},
    "highPrice": {{ product.price_max | divided_by: 100.0 | json }},
    "availability": "{% if product.available %}https://schema.org/InStock{% else %}https://schema.org/OutOfStock{% endif %}",
    "url": "{{ shop.url }}{{ product.url }}"
  }
}
</script>`;

export function pickProductTemplate(profile: StoreProfile): string {
  const body = pickBody(profile.vertical);
  const schemaBlock = SCHEMA_LD_BLOCK.replace(
    "{{SCHEMA_TYPE}}",
    profile.schemaType,
  );
  return body + schemaBlock;
}

function pickBody(vertical: StoreProfile["vertical"]): string {
  switch (vertical) {
    case "supplements_wellness":
      return SUPPLEMENTS_TEMPLATE;
    case "apparel_fashion":
    case "jewelry_accessories":
      return APPAREL_TEMPLATE;
    case "electronics_gadgets":
      return ELECTRONICS_TEMPLATE;
    case "services_subscriptions":
    case "digital_courses":
      return SERVICE_TEMPLATE;
    case "food_beverage":
    case "pet_supplies":
      return FOOD_TEMPLATE;
    default:
      return GENERAL_TEMPLATE;
  }
}
