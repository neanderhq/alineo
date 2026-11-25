import { contextOr401, errorResponse, isResponse, isUuid, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { InputError } from "@/server/objectives";
import { isDuplicateReportView, privateReportViews, reportViewFields, reportViewName, validateReportFilters } from "@/server/report-views";
import { reportViews } from "@/server/schema";

type Params = { params: Promise<{ id: string }> };
const notFound = () => errorResponse("Saved view not found.", 404);

export async function GET(_request: Request, { params }: Params) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [view] = await getDb().select(reportViewFields).from(reportViews).where(privateReportViews(context, id)).limit(1);
  return view ? Response.json({ view }, { headers: { "Cache-Control": "no-store" } }) : notFound();
}

export async function PATCH(request: Request, { params }: Params) {
  const context = await contextOr401(request);
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const scope = privateReportViews(context, id);
  const [existing] = await getDb().select({ id: reportViews.id }).from(reportViews).where(scope).limit(1);
  if (!existing) return notFound();
  const body = await readJson(request);
  try {
    if (body?.name === undefined && body?.filters === undefined) return errorResponse("Enter a name or change the filters.", 400);
    const name = body.name === undefined ? undefined : reportViewName(body.name);
    const filters = body.filters === undefined ? undefined : await validateReportFilters(context, body.filters);
    const [view] = await getDb().update(reportViews).set({ name, filters }).where(scope).returning(reportViewFields);
    return view ? Response.json({ view }) : notFound();
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    if (isDuplicateReportView(error)) return errorResponse("You already have a view with that name.", 409);
    throw error;
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const context = await contextOr401(request);
  if (isResponse(context)) return context;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [view] = await getDb().delete(reportViews).where(privateReportViews(context, id)).returning({ id: reportViews.id });
  return view ? new Response(null, { status: 204 }) : notFound();
}
