import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { isUuid } from "./api-utils";
import { resolveNotifications } from "./notifications";
import { canEditKeyResult, canViewObjective, InputError, isIsoDate, loadObjectiveAccessFacts, viewerFromContext } from "./objectives";
import { calculateProgress } from "./okr-math";
import { recomputeKeyResultFromCheckIns, todayWithinCycle } from "./okr-mutations";
import type { Transaction } from "./people";
import type { RequestContext } from "./request-context";
import { confidenceLevel, keyResultEditors, keyResults, krCheckIns, objectives, okrCycles } from "./schema";

type Executor = ReturnType<typeof getDb> | Transaction;
const NOT_FOUND = "Key result not found in this workspace.";

/** Loads a visible, non-archived key result with its goal and cycle; 404s when the viewer can't see it. */
export async function loadVisibleKeyResult(executor: ReturnType<typeof getDb> | Transaction, context: RequestContext, id: string, lock: boolean) {
  const query = executor.select({ keyResult: keyResults, objective: objectives, cycle: okrCycles })
    .from(keyResults)
    .innerJoin(objectives, and(eq(objectives.id, keyResults.objectiveId), eq(objectives.companyId, context.companyId)))
    .innerJoin(okrCycles, and(eq(okrCycles.id, objectives.cycleId), eq(okrCycles.companyId, context.companyId)))
    .where(and(
      eq(keyResults.id, id),
      eq(keyResults.companyId, context.companyId),
      isNull(keyResults.archivedAt),
      isNull(objectives.archivedAt),
    ));
  const [row] = lock ? await query.for("update", { of: keyResults }).limit(1) : await query.limit(1);
  if (!row) throw new InputError(NOT_FOUND, 404);
  const facts = await loadObjectiveAccessFacts(executor, context.companyId, row.objective.id, row.objective.ownerId);
  if (!canViewObjective(row.objective, viewerFromContext(context), facts)) {
    throw new InputError(NOT_FOUND, 404);
  }
  return { ...row, facts };
}

function text(value: unknown, label: string, max: number) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.trim().length > max) throw new InputError(`${label} must be ${max} characters or fewer.`);
  return value.trim();
}

export function parseCheckInInput(body: Record<string, unknown> | null) {
  const version = body?.version;
  if (!body || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    throw new InputError("Include the current key result version to save your check-in.");
  }
  const value = body.value;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) >= 1e10) {
    throw new InputError("Provide a valid value for this check-in.");
  }
  const date = body.effectiveDate;
  if (date !== undefined && date !== null && date !== "" && !isIsoDate(date)) {
    throw new InputError("Effective date must be a valid date (YYYY-MM-DD).");
  }
  if (body.confidence !== undefined && !(confidenceLevel.enumValues as readonly unknown[]).includes(body.confidence)) {
    throw new InputError("Choose a valid confidence level.");
  }
  const correctsCheckInId = body.correctsCheckInId === undefined || body.correctsCheckInId === null || body.correctsCheckInId === ""
    ? null : body.correctsCheckInId;
  if (correctsCheckInId !== null && (typeof correctsCheckInId !== "string" || !isUuid(correctsCheckInId))) {
    throw new InputError("Choose a valid check-in to correct.");
  }
  return {
    version, value, requestedDate: typeof date === "string" && date ? date : null,
    confidence: (body.confidence ?? "on_track") as (typeof confidenceLevel.enumValues)[number],
    note: text(body.note, "Note", 2000), blockers: text(body.blockers, "Blockers", 2000), correctsCheckInId,
  };
}

export async function prepareCheckIn(
  executor: Executor,
  context: RequestContext,
  id: string,
  input: ReturnType<typeof parseCheckInInput>,
  lock = false,
) {
  const { keyResult, objective, cycle, facts } = await loadVisibleKeyResult(executor, context, id, lock);
  if (cycle.status === "closed" || cycle.archivedAt) throw new InputError("This cycle is closed; check-ins are locked.", 403);
  if (cycle.status !== "open") throw new InputError("Open the cycle before checking in on key results.", 403);
  const editors = await executor.select({ userId: keyResultEditors.userId }).from(keyResultEditors)
    .where(eq(keyResultEditors.keyResultId, id));
  if (!canEditKeyResult(objective, keyResult, viewerFromContext(context), facts, editors.map(editor => editor.userId))) {
    throw new InputError("Only the key result owner, its editors, goal owners and editors, managers and admins can check in.", 403);
  }
  if (keyResult.version !== input.version) throw new InputError("Someone else updated this key result — refresh and try again.", 409);
  const effectiveDate = input.requestedDate ?? todayWithinCycle(cycle);
  if (effectiveDate < cycle.startDate || effectiveDate > cycle.endDate) {
    throw new InputError(`Effective date must fall within the cycle (${cycle.startDate} to ${cycle.endDate}).`);
  }
  if (input.correctsCheckInId) {
    const history = await executor.select({ id: krCheckIns.id, correctsCheckInId: krCheckIns.correctsCheckInId }).from(krCheckIns)
      .where(and(eq(krCheckIns.keyResultId, id), eq(krCheckIns.companyId, context.companyId)));
    if (!history.some(entry => entry.id === input.correctsCheckInId)) throw new InputError("The check-in being corrected belongs to a different key result.");
    if (history.some(entry => entry.correctsCheckInId === input.correctsCheckInId)) {
      throw new InputError("That check-in has already been corrected. Correct the newer entry instead.");
    }
  }
  let progress: number;
  try {
    progress = calculateProgress(Number(keyResult.baseline), Number(keyResult.target), input.value, keyResult.direction, keyResult.metricType);
  } catch (error) {
    throw new InputError(error instanceof Error ? error.message : "Invalid check-in value.");
  }
  return { input, keyResult, objective, cycle, effectiveDate, progress };
}

export async function writeCheckIn(
  transaction: Transaction,
  context: RequestContext,
  prepared: Awaited<ReturnType<typeof prepareCheckIn>>,
) {
  const { keyResult, objective, cycle, effectiveDate, progress, input } = prepared;
  const actorId = context.session.user.id;
  const [checkIn] = await transaction.insert(krCheckIns).values({
    companyId: context.companyId, cycleId: cycle.id, objectiveId: objective.id, keyResultId: keyResult.id,
    authorId: actorId, effectiveDate, value: input.value.toString(), progress: progress.toFixed(2),
    confidence: input.confidence, note: input.note, blockers: input.blockers, correctsCheckInId: input.correctsCheckInId,
  }).returning();
  const recomputed = await recomputeKeyResultFromCheckIns(transaction, keyResult.id, context.companyId, keyResult.version);
  return {
    keyResult: recomputed.keyResult,
    checkIn: { ...checkIn, isCurrentEffective: recomputed.effectiveCheckIn?.id === checkIn.id },
  };
}


export async function resolveCheckInNotifications(
  transaction: Transaction,
  context: RequestContext,
  { keyResult, objective }: Awaited<ReturnType<typeof prepareCheckIn>>,
) {
  await resolveNotifications(transaction, context.companyId, keyResult.id, ["check_in_cadence", "check_in_request"]);
  await resolveNotifications(transaction, context.companyId, objective.id, ["check_in_request"]);
  await resolveNotifications(transaction, context.companyId, context.session.user.id, ["check_in_request"]);
}
