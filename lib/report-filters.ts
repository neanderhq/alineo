export const reportFilterDefaults = {
  view: "company",
  status: "all",
  confidence: "all",
  q: "",
  overdueOnly: "false",
  staleOnly: "false",
  includeArchived: "false",
  cycleId: "all",
};

export type ReportFilters = typeof reportFilterDefaults;
export type SavedReportView = { id: string; name: string; filters: ReportFilters };
