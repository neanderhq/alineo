import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { BatchRowError, commitBatch, parseBatch, previewBatch } from "@/server/check-in-batches";
import { InputError } from "@/server/objectives";

export async function POST(request: Request) {
  const context = await contextOr401(request);
  if (isResponse(context)) return context;
  const body = await readJson(request);
  try {
    if (body?.action !== "preview" && body?.action !== "commit") return errorResponse("Choose preview or confirm.", 400);
    const batch = parseBatch(body);
    if (body.action === "preview") return Response.json({ rows: await previewBatch(context, batch) });
    if (typeof body.requestId !== "string" || !isUuid(body.requestId)) return errorResponse("Preview the batch before confirming.", 400);
    const receipt = await commitBatch(context, batch, body.requestId.toLowerCase());
    return Response.json({ receipt }, { status: receipt.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof BatchRowError) {
      return Response.json({ error: "Review the marked result before submitting.", rows: [{ id: error.id, message: error.message }] }, { status: error.status });
    }
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && (cause.code === "40P01" || cause.code === "40001")) {
      return errorResponse("Records changed during confirmation. Review the draft and preview again.", 409);
    }
    throw error;
  }
}
