import { NextResponse } from "next/server";
import { contextOr401, errorResponse, isResponse } from "@/server/api-utils";
import { buildReport } from "@/server/reporting";

import { InputError } from "@/server/objectives";
import { reportRequestFilters } from "@/server/report-views";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await contextOr401();
  if (isResponse(context)) return context;
  let selection;
  try {
    selection = await reportRequestFilters(context, request);
  } catch (error) {
    if (error instanceof InputError) return errorResponse(error.message, error.status);
    throw error;
  }
  const { filters } = selection;
  const report = await buildReport(context, filters);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
