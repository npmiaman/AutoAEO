import type { Config } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:./local.db";

// Use the `turso` dialect when talking to libSQL/Turso (anything starting with libsql:// or http(s)://).
// For a local file, use the `sqlite` dialect — drizzle-kit then uses better-sqlite3 to push.
const isRemote = /^(libsql|https?):/.test(url);

export default (
  isRemote
    ? {
        schema: "./src/lib/db/schema.ts",
        out: "./drizzle",
        dialect: "turso",
        dbCredentials: {
          url,
          authToken: process.env.DATABASE_AUTH_TOKEN,
        },
      }
    : {
        schema: "./src/lib/db/schema.ts",
        out: "./drizzle",
        dialect: "sqlite",
        dbCredentials: { url },
      }
) satisfies Config;
