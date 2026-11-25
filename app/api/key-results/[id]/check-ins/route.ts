import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { loadVisibleKeyResult, parseCheckInInput, prepareCheckIn, resolveCheckInNotifications, writeCheckIn } from "@/server/check-ins";
import { getDb } from "@/server/db";
import { InputError } from "@/server/objectives";
import { compareCheckInsNewestFirst, selectEffectiveCheckIn } from "@/server/okr-math";
import { refreshObjectiveProgress } from "@/server/okr-mutations";
import { krCheckIns, user } from "@/server/schema";

const NOT_FOUND = "Key result not found in this workspace.";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse(NOT_FOUND, 404);

  try {
    const database = getDb();
    await loadVisibleKeyResult(database, context, id, false);
    const rows = await database.select({ checkIn: krCheckIns, authorName: user.name })
      .from(krCheckIns)
      .leftJoin(user, eq(user.id, krCheckIns.authorId))
      .where(and(eq(krCheckIns.keyResultId, id), eq(krCheckIns.companyId, context.companyId)));
    const history = rows.map((row) => row.checkIn);
    const effectiveId = selectEffectiveCheckIn(history)?.id ?? null;
    const supersededBy = new Map(history.filter((entry) => entry.correctsCheckInId).map((entry) => [entry.correctsCheckInId!, entry.id]));
    const checkIns = rows
      .sort((a, b) => compareCheckInsNewestFirst(a.checkIn, b.checkIn))
      .map(({ checkIn, authorName }) => ({
        id: checkIn.id,
        authorId: checkIn.authorId,
        authorName: authorName ?? "Former member",
        effectiveDate: checkIn.effectiveDate,
        value: checkIn.value,
        progress: checkIn.progress,
        confidence: checkIn.confidence,
        note: checkIn.note,
        blockers: checkIn.blockers,
        correctsCheckInId: checkIn.correctsCheckInId,
        supersededById: supersededBy.get(checkIn.id) ?? null,
        isSuperseded: supersededBy.has(checkIn.id),
        isCurrentEffective: checkIn.id === effectiveId,
        createdAt: checkIn.createdAt,
      }));
    return NextResponse.json({ checkIns });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextOr401(request);
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return errorResponse(NOT_FOUND, 404);
  try {
    const input = parseCheckInInput(await readJson(request));
    const result = await getDb().transaction(async transaction => {
      const prepared = await prepareCheckIn(transaction, context, id, input, true);
      const recorded = await writeCheckIn(transaction, context, prepared);
      await refreshObjectiveProgress(transaction, prepared.objective.id, context.companyId);
      await resolveCheckInNotifications(transaction, context, prepared);
      return recorded;
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}
