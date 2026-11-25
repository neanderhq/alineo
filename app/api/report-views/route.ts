import { contextOr401, errorResponse, isResponse, readJson } from "@/server/api-utils";
import { getDb } from "@/server/db";
import { InputError } from "@/server/objectives";
import { privateReportViews, reportViewFields, reportViewName, validateReportFilters } from "@/server/report-views";
import { reportViews } from "@/server/schema";

export async function GET() {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  const views = await getDb().select(reportViewFields).from(reportViews)
    .where(privateReportViews(context)).orderBy(reportViews.name);
  return Response.json({ views }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await contextOr401(request);
  if (isResponse(context)) return context;
  const body = await readJson(request);
  try {
    const name = reportViewName(body?.name);
    const filters = await validateReportFilters(context, body?.filters);
    const [view] = await getDb().insert(reportViews).values({
      companyId: context.companyId, ownerId: context.session.user.id, name, filters,
    }).onConflictDoNothing().returning(reportViewFields);
    if (!view) return errorResponse("You already have a view with that name.", 409);
    return Response.json({ view }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
}
