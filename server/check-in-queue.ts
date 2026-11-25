import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "./db";
import { checkInRequestKey, createNotifications } from "./notifications";
import { InputError } from "./objectives";
import { selectEffectiveCheckIn } from "./okr-math";
import { canViewObjective, loadAccessIndex, viewerFromChart } from "./org-access";
import type { Transaction } from "./people";
import { CADENCE_DAYS, stalePeriodBucket } from "./reminders";
import type { RequestContext } from "./request-context";
import { checkInReviews, companyMemberships, keyResults, krCheckIns, objectives, okrCycles, user } from "./schema";

type Executor = ReturnType<typeof getDb> | Transaction;
const unavailable = "This result is no longer available in your queue.";

export async function loadCheckInQueue(executor: Executor, context: RequestContext, cycleId: string, resultId?: string) {
  const reviewerId = context.session.user.id;
  const companyId = context.companyId;
  if (resultId) {
    const [reviewer] = await executor.select({ role: companyMemberships.role }).from(companyMemberships)
      .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, reviewerId), eq(companyMemberships.isActive, true)))
      .for("share").limit(1);
    if (!reviewer || reviewer.role === "member") throw new InputError(unavailable, 404);
  }
  const query = executor.select({
    result: keyResults, goal: objectives, ownerId: companyMemberships.userId,
    ownerName: user.name, cadence: okrCycles.checkInCadence,
  }).from(keyResults)
    .innerJoin(objectives, and(eq(objectives.id, keyResults.objectiveId), eq(objectives.companyId, companyId)))
    .innerJoin(okrCycles, and(eq(okrCycles.id, objectives.cycleId), eq(okrCycles.companyId, companyId)))
    .innerJoin(companyMemberships, and(
      eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.userId, sql<string>`coalesce(${keyResults.ownerId}, ${objectives.ownerId})`),
      eq(companyMemberships.managerId, reviewerId),
      eq(companyMemberships.isActive, true),
    ))
    .innerJoin(user, eq(user.id, companyMemberships.userId))
    .where(and(
      eq(keyResults.companyId, companyId), eq(okrCycles.id, cycleId),
      eq(okrCycles.status, "open"), isNull(okrCycles.archivedAt),
      eq(objectives.status, "active"), isNull(objectives.archivedAt), isNull(keyResults.archivedAt),
      lt(keyResults.progress, "100"), resultId ? eq(keyResults.id, resultId) : undefined,
    )).orderBy(asc(user.name), asc(keyResults.title), asc(keyResults.id));
  // Action reads lock the rows that determine queue membership until the write commits.
  const rows = resultId ? await query.for("share", { of: [keyResults, objectives, okrCycles, companyMemberships] }) : await query;
  if (!rows.length) return [];
  const access = await loadAccessIndex(executor, companyId, rows.map(({ goal }) => goal.id));
  const viewer = viewerFromChart(access.chart, reviewerId);
  if (!viewer || viewer.role === "member") return [];
  const now = new Date();
  const eligible = rows.flatMap((row) => {
    if (!canViewObjective(row.goal, viewer, access.factsFor(row.goal))) return [];
    const stale = stalePeriodBucket(row.result.lastCheckInAt ?? row.result.createdAt, now, CADENCE_DAYS[row.cadence]) !== null;
    const risk = row.result.confidence === "on_track" ? null : row.result.confidence;
    return stale || risk ? [{ ...row, stale, risk }] : [];
  });
  const riskIds = eligible.filter((row) => row.risk).map(({ result }) => result.id);
  const history = riskIds.length ? await executor.select({
    id: krCheckIns.id, keyResultId: krCheckIns.keyResultId, createdAt: krCheckIns.createdAt,
    effectiveDate: krCheckIns.effectiveDate, correctsCheckInId: krCheckIns.correctsCheckInId,
  }).from(krCheckIns).where(and(eq(krCheckIns.companyId, companyId), inArray(krCheckIns.keyResultId, riskIds))) : [];
  const byResult = Map.groupBy(history, (entry) => entry.keyResultId);
  const effective = eligible.map((row) => row.risk ? selectEffectiveCheckIn(byResult.get(row.result.id) ?? []) : null);
  const effectiveIds = effective.flatMap((entry) => entry ? [entry.id] : []);
  const reviews = effectiveIds.length ? await executor.select({ checkInId: checkInReviews.checkInId }).from(checkInReviews)
    .where(and(eq(checkInReviews.companyId, companyId), eq(checkInReviews.reviewerId, reviewerId),
      inArray(checkInReviews.checkInId, effectiveIds))) : [];
  const reviewed = new Set(reviews.map((row) => row.checkInId));
  return eligible.map(({ result, goal, ownerId, ownerName, stale, risk }, index) => ({
    id: result.id, title: result.title, goalId: goal.id, goalTitle: goal.title, ownerId, ownerName,
    progress: result.progress, lastEffectiveDate: result.lastEffectiveDate, stale, risk,
    checkInId: effective[index]?.id ?? null,
    reviewed: Boolean(effective[index] && reviewed.has(effective[index]!.id)),
  }));
}

export type CheckInQueueItem = Awaited<ReturnType<typeof loadCheckInQueue>>[number];

export async function actOnQueueItem(context: RequestContext, cycleId: string, resultId: string, action: "request" | "review", checkInId?: unknown) {
  return getDb().transaction(async (tx) => {
    const [item] = await loadCheckInQueue(tx, context, cycleId, resultId);
    if (!item) throw new InputError(unavailable, 404);
    if (action === "review") {
      if (!item.checkInId || item.checkInId !== checkInId) {
        throw new InputError("The effective check-in has changed. Open the latest result to review it.", 409);
      }
      await tx.insert(checkInReviews).values({
        companyId: context.companyId, reviewerId: context.session.user.id, checkInId: item.checkInId,
      }).onConflictDoNothing();
      return { reviewed: true };
    }
    const created = await createNotifications(tx, [{
      companyId: context.companyId, recipientId: item.ownerId, actorId: context.session.user.id,
      type: "check_in_request", title: `${context.session.user.name} asked for a check-in on ${item.title}`,
      body: "Please post an update with your latest value and confidence.",
      objectiveId: item.goalId, entityType: "key_result", entityId: item.id,
      dedupKey: checkInRequestKey(item.id, item.ownerId),
    }], { email: false });
    return { created: created.length > 0 };
  });
}
