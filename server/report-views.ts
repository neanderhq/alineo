import { and, eq, isNull } from "drizzle-orm";
import { isUuid } from "./api-utils";
import { getDb } from "./db";
import { parseGoalQueryFilters } from "./goal-query";
import { InputError } from "./objectives";
import type { RequestContext } from "./request-context";
import { okrCycles, reportViews } from "./schema";
import { reportFilterDefaults, type ReportFilters } from "../lib/report-filters";

export const reportViewFields = { id: reportViews.id, name: reportViews.name, filters: reportViews.filters };

export function privateReportViews(context: RequestContext, id?: string) {
  return and(eq(reportViews.companyId, context.companyId), eq(reportViews.ownerId, context.session.user.id),
    id ? eq(reportViews.id, id) : undefined);
}

export function reportViewName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new InputError("Enter a view name of 1–80 characters.");
  }
  return name;
}

export function isDuplicateReportView(error: unknown) {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  return Boolean(cause && typeof cause === "object" && "constraint" in cause && cause.constraint === "report_views_owner_name_idx");
}

const choices = {
  view: ["company", "team", "my"],
  status: ["all", "active", "draft", "completed", "cancelled"],
  confidence: ["all", "on_track", "at_risk", "off_track"],
  overdueOnly: ["true", "false"],
  staleOnly: ["true", "false"],
  includeArchived: ["true", "false"],
} satisfies Partial<Record<keyof ReportFilters, string[]>>;

export async function validateReportFilters(context: RequestContext, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Choose valid report filters.");
  const input = value as Record<string, unknown>;
  const filters = { ...reportFilterDefaults };
  for (const key of Object.keys(filters) as (keyof ReportFilters)[]) {
    if (input[key] === undefined) continue;
    const entry = input[key];
    if (typeof entry !== "string" || entry.length > 200 || entry.includes("\0")) {
      throw new InputError("Choose valid report filters.");
    }
    filters[key] = entry.trim();
  }
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    if (!choices[key].includes(filters[key])) throw new InputError("Choose valid report filters.");
  }
  if (!await isReportCycleAvailable(context.companyId, filters.cycleId, filters.includeArchived === "true")) {
    throw new InputError("This period is unavailable. Choose another report cycle.", 409);
  }
  return filters;
}

async function isReportCycleAvailable(companyId: string, cycleId: string, archived: boolean) {
  if (cycleId === "all") return true;
  if (!isUuid(cycleId)) return false;
  const [cycle] = await getDb().select({ id: okrCycles.id }).from(okrCycles)
    .where(and(eq(okrCycles.companyId, companyId), eq(okrCycles.id, cycleId), archived ? undefined : isNull(okrCycles.archivedAt)))
    .limit(1);
  return Boolean(cycle);
}

export async function reportRequestFilters(context: RequestContext, request: Request) {
  const query = new URL(request.url).searchParams;
  const filters = parseGoalQueryFilters(query);
  const fromReports = query.get("report") === "true";
  if (fromReports) {
    if (filters.cycleId === "all") filters.cycleId = undefined;
    if (!await isReportCycleAvailable(context.companyId, filters.cycleId ?? "all", Boolean(filters.includeArchived))) {
      throw new InputError("This period is unavailable. Choose another report cycle.", 409);
    }
    filters.omitArchivedCycles = !filters.includeArchived;
  }
  return { filters, fromReports };
}
