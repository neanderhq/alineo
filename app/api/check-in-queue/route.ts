import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { actOnQueueItem, loadCheckInQueue } from "@/server/check-in-queue";
import { getDb } from "@/server/db";
import { InputError } from "@/server/objectives";

export async function GET(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  if (context.role === "member") return errorResponse("Only managers and admins can open the check-in queue.", 403);
  const cycleId = new URL(request.url).searchParams.get("cycleId") ?? "";
  if (!isUuid(cycleId)) return errorResponse("Choose an open cycle.", 400);
  const items = await loadCheckInQueue(getDb(), context, cycleId);
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await contextOr401(request);
  if (isResponse(context)) return context;
  if (context.role === "member") return errorResponse("Only managers and admins can act from the check-in queue.", 403);
  const body = await readJson(request);
  const { action, cycleId, resultId, checkInId } = body ?? {};
  if (typeof cycleId !== "string" || typeof resultId !== "string" || !isUuid(cycleId) || !isUuid(resultId) ||
      (action !== "request" && action !== "review")) {
    return errorResponse("Choose a result and an action.", 400);
  }
  try {
    return Response.json(await actOnQueueItem(context, cycleId, resultId, action, checkInId));
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}
