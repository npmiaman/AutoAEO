import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { cliToken } from "@/lib/db/schema";

// ─────────────────────────────────────────────────────────────────────
// CLI personal access tokens. Minted from the web app (logged-in user), pasted
// into `pigeon login`. A token authenticates the CLI/API to a whole account
// (all its workspaces). Bearer-only; shown once at creation.
// ─────────────────────────────────────────────────────────────────────

/** Mint a new CLI token for a user. Returns the plaintext token (show once). */
export async function createCliToken(
  userId: string,
  name?: string,
): Promise<string> {
  const token = `pgn_${nanoid(40)}`;
  await db.insert(cliToken).values({
    id: nanoid(),
    userId,
    token,
    name: name?.slice(0, 80) ?? null,
  });
  return token;
}

/** Resolve the Bearer CLI token on a request to a userId (or null). Touches lastUsedAt. */
export async function authCliToken(req: Request): Promise<string | null> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = bearer?.trim();
  if (!token || !token.startsWith("pgn_")) return null;

  const [row] = await db
    .select({ id: cliToken.id, userId: cliToken.userId })
    .from(cliToken)
    .where(eq(cliToken.token, token))
    .limit(1);
  if (!row) return null;

  await db
    .update(cliToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(cliToken.id, row.id));
  return row.userId;
}
