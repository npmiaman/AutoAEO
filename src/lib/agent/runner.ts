import "server-only";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRun,
  changeProposal,
  shop as shopTable,
} from "@/lib/db/schema";
import { createShopifyClient } from "@/lib/shopify/client";
import type { Playbook, ProposedChange } from "./types";

/**
 * Execute a playbook against a connected shop and persist its proposals.
 * Returns the run id so callers can navigate to the review page.
 */
export async function runPlaybook(
  shopId: string,
  playbook: Playbook,
): Promise<string> {
  const [s] = await db
    .select()
    .from(shopTable)
    .where(eq(shopTable.id, shopId))
    .limit(1);
  if (!s) throw new Error("Shop not found");

  const runId = nanoid();
  await db.insert(agentRun).values({
    id: runId,
    shopId,
    playbook: playbook.id,
    status: "running",
    summary: `Running ${playbook.name}…`,
  });

  try {
    const shopify = createShopifyClient({
      shopDomain: s.shopDomain,
      accessTokenEnc: s.accessTokenEnc,
    });

    const result = await playbook.run({ shopId, shopify });

    if (result.proposals.length > 0) {
      await db.insert(changeProposal).values(
        result.proposals.map((p) => mapProposal(runId, p)),
      );
    }

    await db
      .update(agentRun)
      .set({
        status:
          result.proposals.length > 0 ? "awaiting_approval" : "succeeded",
        summary: result.summary,
        metricsJson: result.metrics ? JSON.stringify(result.metrics) : null,
        completedAt: new Date(),
      })
      .where(eq(agentRun.id, runId));

    return runId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(agentRun)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(agentRun.id, runId));
    throw err;
  }
}

function mapProposal(runId: string, p: ProposedChange) {
  return {
    id: nanoid(),
    runId,
    kind: p.kind,
    target: p.target,
    title: p.title,
    description: p.description ?? null,
    beforeJson: p.before === undefined ? null : JSON.stringify(p.before),
    afterJson: JSON.stringify(p.after),
    status: "pending" as const,
  };
}
