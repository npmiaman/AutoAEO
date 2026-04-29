// ─────────────────────────────────────────────────────────────────────
// Schema Markup playbook generator. Pure content; no I/O.
//
// Produces a single Liquid snippet that emits the right JSON-LD per
// page (Organization + WebSite globally; Product + BreadcrumbList on
// product pages; CollectionPage on collections; BlogPosting on
// articles; FAQPage when an autoaeo.faq metafield is present).
//
// All schema is generated dynamically by Liquid at request time using
// the merchant's own data — no hardcoded values per store.
// ─────────────────────────────────────────────────────────────────────

export const AUTOAEO_SCHEMA_SNIPPET = `{%- comment -%}
  AutoAEO — schema.org JSON-LD for search engines and AI agents.
  Emits Organization + WebSite on every page, plus per-template schema
  for products, collections, articles, and pages. FAQPage is emitted
  when a page has an autoaeo.faq metafield (populated by FAQ playbook).
{%- endcomment -%}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "{{ shop.url }}#organization",
      "name": {{ shop.name | json }},
      "url": "{{ shop.url }}"
      {%- if settings.logo %},
      "logo": {
        "@type": "ImageObject",
        "url": "{{ settings.logo | image_url: width: 600 }}"
      }
      {%- endif -%}
      {%- if shop.email != blank %},
      "email": {{ shop.email | json }}
      {%- endif -%}
      {%- if shop.phone != blank %},
      "telephone": {{ shop.phone | json }}
      {%- endif -%}
    },
    {
      "@type": "WebSite",
      "@id": "{{ shop.url }}#website",
      "url": "{{ shop.url }}",
      "name": {{ shop.name | json }},
      "publisher": { "@id": "{{ shop.url }}#organization" },
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "{{ shop.url }}/search?q={search_term_string}"
        },
        "query-input": "required name=search_term_string"
      }
    }

    {%- if template contains 'product' and product -%}
    ,{
      "@type": "Product",
      "@id": "{{ shop.url }}{{ product.url }}#product",
      "name": {{ product.title | json }},
      "url": "{{ shop.url }}{{ product.url }}",
      "image": [
        {%- for img in product.images limit: 5 -%}
        "{{ img | image_url: width: 1200 }}"{%- unless forloop.last -%},{%- endunless -%}
        {%- endfor -%}
      ],
      "description": {{ product.description | strip_html | truncate: 5000 | json }},
      {%- if product.selected_or_first_available_variant.sku != blank %}
      "sku": {{ product.selected_or_first_available_variant.sku | json }},
      {%- endif %}
      "brand": {
        "@type": "Brand",
        "name": {{ product.vendor | default: shop.name | json }}
      },
      "offers": {
        "@type": "AggregateOffer",
        "priceCurrency": {{ shop.currency | json }},
        "lowPrice": "{{ product.price_min | divided_by: 100.0 }}",
        "highPrice": "{{ product.price_max | divided_by: 100.0 }}",
        "offerCount": {{ product.variants.size }},
        "availability": "{% if product.available %}https://schema.org/InStock{% else %}https://schema.org/OutOfStock{% endif %}",
        "url": "{{ shop.url }}{{ product.url }}"
      }
      {%- if product.metafields.reviews.rating_count and product.metafields.reviews.rating_count.value > 0 %},
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "{{ product.metafields.reviews.rating.value }}",
        "reviewCount": "{{ product.metafields.reviews.rating_count.value }}"
      }
      {%- endif -%}
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "{{ shop.url }}" }
        {%- if collection -%}
        , { "@type": "ListItem", "position": 2, "name": {{ collection.title | json }}, "item": "{{ shop.url }}{{ collection.url }}" }
        , { "@type": "ListItem", "position": 3, "name": {{ product.title | json }}, "item": "{{ shop.url }}{{ product.url }}" }
        {%- else -%}
        , { "@type": "ListItem", "position": 2, "name": "Products", "item": "{{ shop.url }}/collections/all" }
        , { "@type": "ListItem", "position": 3, "name": {{ product.title | json }}, "item": "{{ shop.url }}{{ product.url }}" }
        {%- endif -%}
      ]
    }
    {%- endif -%}

    {%- if template contains 'collection' and collection -%}
    ,{
      "@type": "CollectionPage",
      "@id": "{{ shop.url }}{{ collection.url }}#collectionpage",
      "name": {{ collection.title | json }},
      "description": {{ collection.description | strip_html | truncate: 2000 | json }},
      "url": "{{ shop.url }}{{ collection.url }}"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "{{ shop.url }}" },
        { "@type": "ListItem", "position": 2, "name": "Collections", "item": "{{ shop.url }}/collections" },
        { "@type": "ListItem", "position": 3, "name": {{ collection.title | json }}, "item": "{{ shop.url }}{{ collection.url }}" }
      ]
    }
    {%- endif -%}

    {%- if template contains 'article' and article -%}
    ,{
      "@type": "BlogPosting",
      "@id": "{{ shop.url }}{{ article.url }}#article",
      "headline": {{ article.title | json }},
      "image": [{%- if article.image -%}"{{ article.image | image_url: width: 1200 }}"{%- endif -%}],
      "datePublished": "{{ article.published_at | date: '%FT%T%z' }}",
      "dateModified": "{{ article.updated_at | date: '%FT%T%z' }}",
      "author": {
        "@type": "Person",
        "name": {{ article.author | default: shop.name | json }}
      },
      "publisher": { "@id": "{{ shop.url }}#organization" },
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": "{{ shop.url }}{{ article.url }}"
      },
      "description": {{ article.excerpt_or_content | strip_html | truncate: 3000 | json }}
    }
    {%- endif -%}

    {%- if template contains 'page' and page -%}
    ,{
      "@type": "WebPage",
      "@id": "{{ shop.url }}{{ page.url }}#webpage",
      "name": {{ page.title | json }},
      "url": "{{ shop.url }}{{ page.url }}",
      "isPartOf": { "@id": "{{ shop.url }}#website" }
    }
    {%- if page.metafields.autoaeo.faq -%}
    ,{
      "@type": "FAQPage",
      "@id": "{{ shop.url }}{{ page.url }}#faq",
      "mainEntity": {{ page.metafields.autoaeo.faq.value }}
    }
    {%- endif -%}
    {%- endif -%}
  ]
}
</script>
`;

const INJECT_MARKER = "<!-- autoaeo-schema -->";
const INJECT_BLOCK = `${INJECT_MARKER}
{% render 'autoaeo-schema' %}
<!-- /autoaeo-schema -->`;

/**
 * Returns true if the merchant's theme.liquid already has our schema
 * snippet rendered. Lets the playbook skip a no-op proposal.
 */
export function themeLiquidHasSchemaInjection(themeLiquid: string): boolean {
  return themeLiquid.includes("autoaeo-schema");
}

/**
 * Inject `{% render 'autoaeo-schema' %}` immediately before </head>.
 */
export function injectSchemaRender(themeLiquid: string): string {
  if (themeLiquidHasSchemaInjection(themeLiquid)) return themeLiquid;
  const idx = themeLiquid.toLowerCase().indexOf("</head>");
  if (idx === -1) return `${themeLiquid}\n${INJECT_BLOCK}\n`;
  return `${themeLiquid.slice(0, idx)}${INJECT_BLOCK}\n${themeLiquid.slice(idx)}`;
}
