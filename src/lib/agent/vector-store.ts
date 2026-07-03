import "server-only";
import { createClient, type Client as LibsqlClient } from "@libsql/client";
import { buildEmbeddings, EMBEDDING_DIMENSIONS } from "./embeddings";

// ─────────────────────────────────────────────────────────────────────
// Vector store backed by libsql's native F32_BLOB column type and
// libsql_vector_idx ANN index. Stores per-shop product embeddings so
// that downstream content generation can retrieve semantically related
// products as context (RAG-style, single-process).
//
// Why libsql vs a separate vector DB:
//   - Same DB as the rest of Pigeon (no extra infra to operate)
//   - libsql ships ANN indexes natively (no extra extension)
//   - Works locally (file:./local.db) and on Turso for production
//
// Usage:
//   await ensureVectorTable();
//   await upsertProductEmbeddings(shopId, [{handle, title, content}, ...]);
//   const hits = await retrieveSimilarProducts(shopId, queryText, 5);
// ─────────────────────────────────────────────────────────────────────

let _client: LibsqlClient | null = null;
function client(): LibsqlClient {
  if (_client) return _client;
  _client = createClient({
    url: process.env.DATABASE_URL ?? "file:./local.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return _client;
}

let _initialized = false;

/**
 * Idempotent — creates the vector table and ANN index if they don't exist.
 * Safe to call before each use.
 */
export async function ensureVectorTable(): Promise<void> {
  if (_initialized) return;
  const c = client();

  await c.execute(`
    CREATE TABLE IF NOT EXISTS product_embedding (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      product_handle TEXT NOT NULL,
      product_title TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding F32_BLOB(${EMBEDDING_DIMENSIONS}) NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(shop_id, product_handle)
    )
  `);

  // libsql ANN index (DiskANN). Uses cosine distance by default.
  await c.execute(`
    CREATE INDEX IF NOT EXISTS product_embedding_ann_idx
    ON product_embedding(libsql_vector_idx(embedding))
  `);

  _initialized = true;
}

export interface ProductEmbeddingInput {
  handle: string;
  title: string;
  content: string; // text used for embedding (title + description, etc.)
}

/**
 * Embed a batch of product texts and upsert them keyed by (shop, handle).
 * Re-embeds on every call — fine for our scale (<= 100 products / run).
 */
export async function upsertProductEmbeddings(
  shopId: string,
  products: ProductEmbeddingInput[],
): Promise<number> {
  if (products.length === 0) return 0;
  await ensureVectorTable();
  const c = client();
  const embeddings = buildEmbeddings();

  const texts = products.map(
    (p) => `${p.title}\n\n${p.content.slice(0, 2000)}`,
  );
  const vectors = await embeddings.embedDocuments(texts);

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const vec = vectors[i];
    const id = `${shopId}:${p.handle}`;
    // libsql accepts vectors as a JSON array string via vector32(...)
    const vectorJson = JSON.stringify(vec);
    await c.execute({
      sql: `
        INSERT INTO product_embedding (id, shop_id, product_handle, product_title, content, embedding)
        VALUES (?, ?, ?, ?, ?, vector32(?))
        ON CONFLICT(shop_id, product_handle) DO UPDATE SET
          product_title = excluded.product_title,
          content = excluded.content,
          embedding = excluded.embedding,
          created_at = unixepoch()
      `,
      args: [id, shopId, p.handle, p.title, p.content, vectorJson],
    });
  }
  return products.length;
}

export interface SimilarProductHit {
  handle: string;
  title: string;
  content: string;
  distance: number;
}

/**
 * Retrieve the top-k products most similar to the given query text,
 * scoped to a single shop. Uses libsql's native ANN index.
 */
export async function retrieveSimilarProducts(
  shopId: string,
  queryText: string,
  k: number = 5,
): Promise<SimilarProductHit[]> {
  await ensureVectorTable();
  const c = client();
  const embeddings = buildEmbeddings();
  const [queryVec] = await embeddings.embedDocuments([queryText]);
  const queryJson = JSON.stringify(queryVec);

  // vector_top_k returns the row-id and distance for the nearest k rows
  // matching the index. We then JOIN back to the source table to read content.
  const result = await c.execute({
    sql: `
      SELECT pe.product_handle, pe.product_title, pe.content,
             vector_distance_cos(pe.embedding, vector32(?)) AS distance
      FROM product_embedding pe
      WHERE pe.shop_id = ?
      ORDER BY distance ASC
      LIMIT ?
    `,
    args: [queryJson, shopId, k],
  });

  return result.rows.map((row) => ({
    handle: String(row.product_handle),
    title: String(row.product_title),
    content: String(row.content),
    distance: Number(row.distance),
  }));
}

/**
 * Delete all embeddings for a shop. Useful when a shop is removed or
 * before a full re-index.
 */
export async function clearShopEmbeddings(shopId: string): Promise<void> {
  await ensureVectorTable();
  const c = client();
  await c.execute({
    sql: `DELETE FROM product_embedding WHERE shop_id = ?`,
    args: [shopId],
  });
}
