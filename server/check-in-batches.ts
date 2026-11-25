import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { MAX_BATCH_RESULTS } from "../lib/check-in-batch";
import { isUuid } from "./api-utils";
import { parseCheckInInput, prepareCheckIn, resolveCheckInNotifications, writeCheckIn } from "./check-ins";
import { getDb } from "./db";
import { InputError, isIsoDate } from "./objectives";
import { refreshObjectiveProgress } from "./okr-mutations";
import type { Transaction } from "./people";
import type { RequestContext } from "./request-context";
import { checkInBatchReceipts, companyMemberships, keyResults, objectives, okrCycles } from "./schema";

export class BatchRowError extends InputError {
  constructor(readonly id: string, error: InputError) {
    super(error.message, error.status);
  }
}

export function parseBatch(body: Record<string, unknown> | null) {
  if (!body || typeof body.cycleId !== "string" || !isUuid(body.cycleId) || !isIsoDate(body.effectiveDate)) {
    throw new InputError("Choose an open cycle and a valid effective date.");
  }
  const date = body.effectiveDate as string;
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_BATCH_RESULTS) {
    throw new InputError(`Select between 1 and ${MAX_BATCH_RESULTS} results.`);
  }
  const ids = new Set<string>();
  const rows = body.rows.map((row: unknown) => {
    if (!row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string" || !isUuid(row.id)) {
      throw new InputError("Every row must identify a key result.");
    }
    const id = row.id.toLowerCase();
    if (ids.has(id)) throw new BatchRowError(id, new InputError("Select each result only once."));
    ids.add(id);
    const entry = row as Record<string, unknown>;
    try {
      if (entry.confidence === undefined) throw new InputError("Choose a confidence level.");
      const input = parseCheckInInput({ version: entry.version, value: entry.value, confidence: entry.confidence, effectiveDate: date });
      return { id, input };
    } catch (error) {
      if (error instanceof InputError) throw new BatchRowError(id, error);
      throw error;
    }
  });
  return { cycleId: body.cycleId.toLowerCase(), date, rows: rows.sort((first, second) => first.id.localeCompare(second.id)) };
}

type Batch = ReturnType<typeof parseBatch>;

async function prepareBatch(executor: ReturnType<typeof getDb> | Transaction, context: RequestContext, batch: Batch) {
  const prepared = [];
  for (const row of batch.rows) {
    try {
      const entry = await prepareCheckIn(executor, context, row.id, row.input);
      if (entry.cycle.id !== batch.cycleId || entry.objective.status !== "active") {
        throw new InputError("This result is not available for the selected cycle.", 404);
      }
      prepared.push(entry);
    } catch (error) {
      if (error instanceof InputError) throw new BatchRowError(row.id, error);
      throw error;
    }
  }
  return prepared;
}

export async function previewBatch(context: RequestContext, batch: Batch) {
  const entries = await prepareBatch(getDb(), context, batch);
  return entries.map(entry => ({
    id: entry.keyResult.id, title: entry.keyResult.title, value: entry.input.value, confidence: entry.input.confidence,
    progress: entry.progress, wouldBeCurrent: !entry.keyResult.lastEffectiveDate || entry.effectiveDate >= entry.keyResult.lastEffectiveDate,
  }));
}

export async function commitBatch(context: RequestContext, batch: Batch, requestId: string) {
  const { companyId } = context;
  const actorId = context.session.user.id;
  const digest = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
  return getDb().transaction(async tx => {
    const [actor] = await tx.select({ role: companyMemberships.role }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, actorId), eq(companyMemberships.isActive, true),
    )).for("share").limit(1);
    if (!actor) throw new InputError("Your workspace access is unavailable.", 403);

    const [reserved] = await tx.insert(checkInBatchReceipts)
      .values({ companyId, actorId, requestId, digest, count: batch.rows.length })
      .onConflictDoNothing().returning({ count: checkInBatchReceipts.count });
    if (!reserved) {
      const [original] = await tx.select().from(checkInBatchReceipts).where(and(
        eq(checkInBatchReceipts.companyId, companyId), eq(checkInBatchReceipts.actorId, actorId), eq(checkInBatchReceipts.requestId, requestId),
      )).limit(1);
      if (original?.digest !== digest) throw new InputError("This submission was already used for another batch.", 409);
      return { requestId, count: original.count, replayed: true };
    }

    const [cycle] = await tx.select({ id: okrCycles.id }).from(okrCycles).where(and(
      eq(okrCycles.companyId, companyId), eq(okrCycles.id, batch.cycleId), eq(okrCycles.status, "open"), isNull(okrCycles.archivedAt),
    )).for("share").limit(1);
    if (!cycle) throw new BatchRowError(batch.rows[0].id, new InputError("This cycle is no longer open.", 409));

    // Take all result locks first, then lock affected goals in the same order for every batch.
    const results = await tx.select({ objectiveId: keyResults.objectiveId }).from(keyResults).where(and(
      eq(keyResults.companyId, companyId), inArray(keyResults.id, batch.rows.map(row => row.id)),
    )).orderBy(asc(keyResults.id)).for("update");
    const goals = [...new Set(results.map(row => row.objectiveId))].sort();
    if (goals.length) {
      await tx.select({ id: objectives.id }).from(objectives).where(and(
        eq(objectives.companyId, companyId), inArray(objectives.id, goals),
      )).orderBy(asc(objectives.id)).for("no key update");
    }

    const entries = await prepareBatch(tx, { ...context, role: actor.role }, batch);
    for (const entry of entries) await writeCheckIn(tx, context, entry);
    for (const id of goals) await refreshObjectiveProgress(tx, id, companyId);
    for (const entry of entries) await resolveCheckInNotifications(tx, context, entry);
    return { requestId, count: reserved.count, replayed: false };
  });
}
