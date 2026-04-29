"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  agentRun,
  changeProposal,
  shop as shopTable,
} from "@/lib/db/schema";
import { runPlaybook } from "@/lib/agent/runner";
import { getPlaybook } from "@/lib/agent/playbooks";
import { applyRun, rollbackRun } from "@/lib/agent/applier";

async function assertShopOwnership(shopId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");
  const [s] = await db
    .select({ id: shopTable.id })
    .from(shopTable)
    .where(
      and(eq(shopTable.id, shopId), eq(shopTable.userId, session.user.id)),
    )
    .limit(1);
  if (!s) throw new Error("Shop not found");
}

async function assertRunOwnership(runId: string): Promise<{ shopId: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const [row] = await db
    .select({
      shopId: agentRun.shopId,
      userId: shopTable.userId,
    })
    .from(agentRun)
    .innerJoin(shopTable, eq(shopTable.id, agentRun.shopId))
    .where(eq(agentRun.id, runId))
    .limit(1);

  if (!row || row.userId !== session.user.id) {
    throw new Error("Run not found");
  }
  return { shopId: row.shopId };
}

// ─── Run a playbook ──────────────────────────────────────────────────

export async function runPlaybookAction(
  shopId: string,
  playbookId: string,
): Promise<void> {
  await assertShopOwnership(shopId);

  const playbook = getPlaybook(playbookId);
  if (!playbook) throw new Error(`Unknown playbook: ${playbookId}`);

  const runId = await runPlaybook(shopId, playbook);
  revalidatePath(`/shops/${shopId}/audit`);
  redirect(`/shops/${shopId}/runs/${runId}`);
}

// ─── Per-proposal review ─────────────────────────────────────────────

export async function approveProposalAction(
  proposalId: string,
): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const [row] = await db
    .select({
      proposalId: changeProposal.id,
      runId: changeProposal.runId,
      shopId: agentRun.shopId,
      userId: shopTable.userId,
    })
    .from(changeProposal)
    .innerJoin(agentRun, eq(agentRun.id, changeProposal.runId))
    .innerJoin(shopTable, eq(shopTable.id, agentRun.shopId))
    .where(eq(changeProposal.id, proposalId))
    .limit(1);

  if (!row || row.userId !== session.user.id) {
    throw new Error("Proposal not found");
  }

  await db
    .update(changeProposal)
    .set({ status: "approved" })
    .where(eq(changeProposal.id, proposalId));

  revalidatePath(`/shops/${row.shopId}/runs/${row.runId}`);
}

export async function rejectProposalAction(
  proposalId: string,
): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const [row] = await db
    .select({
      proposalId: changeProposal.id,
      runId: changeProposal.runId,
      shopId: agentRun.shopId,
      userId: shopTable.userId,
    })
    .from(changeProposal)
    .innerJoin(agentRun, eq(agentRun.id, changeProposal.runId))
    .innerJoin(shopTable, eq(shopTable.id, agentRun.shopId))
    .where(eq(changeProposal.id, proposalId))
    .limit(1);

  if (!row || row.userId !== session.user.id) {
    throw new Error("Proposal not found");
  }

  await db
    .update(changeProposal)
    .set({ status: "rejected" })
    .where(eq(changeProposal.id, proposalId));

  revalidatePath(`/shops/${row.shopId}/runs/${row.runId}`);
}

export async function approveAllPendingAction(runId: string): Promise<void> {
  const { shopId } = await assertRunOwnership(runId);

  await db
    .update(changeProposal)
    .set({ status: "approved" })
    .where(
      and(
        eq(changeProposal.runId, runId),
        eq(changeProposal.status, "pending"),
      ),
    );

  revalidatePath(`/shops/${shopId}/runs/${runId}`);
}

// ─── Apply / rollback ────────────────────────────────────────────────

export async function applyApprovedAction(runId: string): Promise<void> {
  const { shopId } = await assertRunOwnership(runId);
  await applyRun(runId);
  revalidatePath(`/shops/${shopId}/runs/${runId}`);
}

export async function rollbackRunAction(runId: string): Promise<void> {
  const { shopId } = await assertRunOwnership(runId);
  await rollbackRun(runId);
  revalidatePath(`/shops/${shopId}/runs/${runId}`);
}
