"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWorkspace } from "@/components/okr/workspace-context";

import { reportFilterDefaults, type ReportFilters } from "@/lib/report-filters";
import { SavedReportViews } from "./saved-report-views";

interface ReportData {
  cycle: { id: string; name: string; finalReflection: string } | null;
  pagination: { page: number; pageSize: number; totalGoals: number; totalPages: number; hasNextPage: boolean };
  rollups: Record<"company" | "team" | "owner" | "cycle", Array<{ id: string; name: string; goalCount: number; keyResultCount: number; averageProgress: number | null }>>;
  confidenceDistribution: Array<{ confidence: string; count: number }>;
  overdueGoals: Array<{ id: string; title: string; dueDate: string; ownerName: string | null; progress: number }>;
  staleKeyResults: Array<{ id: string; title: string; objectiveTitle: string; ownerName: string | null; lastCheckInAt: string | null; lastEffectiveDate: string | null }>;
  checkInTrend: Array<{ weekOf: string; checkInCount: number; averageProgress: number }>;
  cycleHistory: Array<{ id: string; name: string; finalReflection: string; objectiveCount: number; averageProgress: number | null }>;
  periodComparisons: Array<{ baseCycleName: string; targetCycleName: string; progressDelta: number | null }>;
}

export function ReportsView() {
  const { workspace } = useWorkspace();
  return workspace ? <WorkspaceReports key={workspace.company.id} cycles={workspace.cycles} /> : null;
}

function WorkspaceReports({ cycles }: { cycles: NonNullable<ReturnType<typeof useWorkspace>["workspace"]>["cycles"] }) {
  const [loaded, setLoaded] = useState<{ query: string; report: ReportData } | null>(null);
  const [loadError, setLoadError] = useState<{ query: string; message: string } | null>(null);
  const [filters, setFilters] = useState(reportFilterDefaults);
  const { view, status, confidence, q, overdueOnly, staleOnly, includeArchived, cycleId } = filters;
  const [page, setPage] = useState(1);
  const availableCycles = cycles.filter(cycle => includeArchived === "true" || !cycle.archivedAt);
  const periodAvailable = cycleId === "all" || availableCycles.some(cycle => cycle.id === cycleId);
  const query = new URLSearchParams({
    ...filters, status: status === "all" ? "" : status, confidence: confidence === "all" ? "" : confidence,
    cycleId: cycleId === "all" ? "" : cycleId, report: "true", page: String(page), pageSize: "50",
  }).toString();

  function apply(next: ReportFilters) {
    setPage(1);
    setFilters(next);
  }

  function change(key: keyof ReportFilters, value: string) {
    apply({ ...filters, [key]: value });
  }

  useEffect(() => {
    if (!periodAvailable) return;
    const controller = new AbortController();
    void fetch(`/api/reports?${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (controller.signal.aborted) return;
      if (response.ok) {
        setLoaded({ query, report: value });
        setLoadError(null);
      } else {
        setLoadError({ query, message: value.error ?? "Could not load the report." });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError({ query, message: "Could not load the report. Try again." });
    });
    return () => controller.abort();
  }, [query, periodAvailable]);

  const error = !periodAvailable ? "This period is unavailable. Choose another report cycle." :
    loadError?.query === query ? loadError.message : null;
  const data = !error && loaded?.query === query ? loaded.report : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl lg:text-4xl">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Progress, confidence and check-in trends, calculated only from goals you can see.</p>
        </div>
        {data && <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><a href={`/api/exports/okrs?${query}`}>Export OKRs</a></Button>
          <Button asChild variant="outline"><a href={`/api/exports/check-ins?${query}`}>Export check-ins</a></Button>
        </div>}
      </header>

      <SavedReportViews filters={filters} onApply={apply} periodAvailable={periodAvailable && !error} />

      <Card className="shadow-none">
        <CardHeader><CardTitle>Filters</CardTitle><CardDescription>Choose the goals included in the report and exports.</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Select value={view} onValueChange={value => change("view", value)}><SelectTrigger className="min-w-0 w-full" aria-label="Report scope"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="company">Company</SelectItem><SelectItem value="team">My teams</SelectItem><SelectItem value="my">My goals</SelectItem>
          </SelectContent></Select>
          <Select value={cycleId} onValueChange={value => change("cycleId", value)}><SelectTrigger className="min-w-0 w-full" aria-label="Report cycle"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">All cycles</SelectItem>
            {!periodAvailable && <SelectItem value={cycleId} disabled>Unavailable period</SelectItem>}
            {availableCycles.map((cycle) => <SelectItem key={cycle.id} value={cycle.id}>{cycle.name}</SelectItem>)}
          </SelectContent></Select>
          <Select value={status} onValueChange={value => change("status", value)}><SelectTrigger className="min-w-0 w-full" aria-label="Goal status"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent></Select>
          <Select value={confidence} onValueChange={value => change("confidence", value)}><SelectTrigger className="min-w-0 w-full" aria-label="Goal confidence"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">All confidence</SelectItem><SelectItem value="on_track">On track</SelectItem><SelectItem value="at_risk">At risk</SelectItem><SelectItem value="off_track">Off track</SelectItem>
          </SelectContent></Select>
          <Input aria-label="Search report goals" placeholder="Search goals" value={q} onChange={(event) => change("q", event.target.value)} />
          <Select value={overdueOnly} onValueChange={value => change("overdueOnly", value)}><SelectTrigger className="min-w-0 w-full" aria-label="Due dates"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="false">All due dates</SelectItem><SelectItem value="true">Overdue only</SelectItem>
          </SelectContent></Select>
          <Select value={staleOnly} onValueChange={value => change("staleOnly", value)}><SelectTrigger className="min-w-0 w-full" aria-label="Check-in recency"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="false">All check-ins</SelectItem><SelectItem value="true">Stale only</SelectItem>
          </SelectContent></Select>
          <Select value={includeArchived} onValueChange={value => change("includeArchived", value)}><SelectTrigger className="min-w-0 w-full" aria-label="Archived goals"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="false">Hide archived</SelectItem><SelectItem value="true">Include archived</SelectItem>
          </SelectContent></Select>
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!data && !error && <p role="status" className="text-sm text-muted-foreground">Loading report…</p>}
      {data && <>
      {(["company", "team", "owner", "cycle"] as const).map((kind) => (
        <Card key={kind} className="min-w-0 shadow-none">
          <CardHeader><CardTitle className="capitalize">{kind} rollups</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Goals</TableHead><TableHead>Key results</TableHead><TableHead>Average progress</TableHead></TableRow></TableHeader>
            <TableBody>{data.rollups[kind].map((row) => (
              <TableRow key={`${kind}-${row.id}`}><TableCell>{row.name}</TableCell><TableCell>{row.goalCount}</TableCell><TableCell>{row.keyResultCount}</TableCell><TableCell>{row.averageProgress === null ? "—" : `${row.averageProgress}%`}</TableCell></TableRow>
            ))}</TableBody></Table></CardContent>
        </Card>
      ))}

      <Card className="shadow-none"><CardHeader><CardTitle>Confidence</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">
        {data.confidenceDistribution.map((row) => <Badge key={row.confidence} variant="secondary">{row.confidence.replace("_", " ")}: {row.count}</Badge>)}
      </CardContent></Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-none"><CardHeader><CardTitle>Overdue goals</CardTitle></CardHeader><CardContent className="text-sm">
          {data.overdueGoals.map((goal) => <p key={goal.id}>{goal.title} · {goal.dueDate} · {goal.ownerName ?? "No owner"}</p>)}
          {!data.overdueGoals.length && <p className="text-muted-foreground">None</p>}
        </CardContent></Card>
        <Card className="shadow-none"><CardHeader><CardTitle>Stale check-ins</CardTitle></CardHeader><CardContent className="text-sm">
          {data.staleKeyResults.map((result) => <p key={result.id}>{result.objectiveTitle} · {result.title} · {result.lastEffectiveDate ?? result.lastCheckInAt ?? "never"}</p>)}
          {!data.staleKeyResults.length && <p className="text-muted-foreground">None</p>}
        </CardContent></Card>
      </div>

      <Card className="shadow-none"><CardHeader><CardTitle>Weekly check-in trend</CardTitle><CardDescription>Average progress and check-in volume.</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.checkInTrend.map((week) => (
            <div key={week.weekOf} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"><Badge variant="secondary">{week.weekOf}</Badge>
              <div className="h-2 rounded bg-muted" aria-hidden="true"><div className="h-full rounded bg-primary" style={{ width: `${week.averageProgress}%` }} /></div>
              <span>{week.averageProgress}% · {week.checkInCount} entries</span></div>
          ))}
          {!data.checkInTrend.length && <p className="text-muted-foreground">No check-ins in view.</p>}
        </CardContent>
      </Card>

      <Card className="shadow-none"><CardHeader><CardTitle>Cycle history and comparisons</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        {data.cycleHistory.map((cycle) => (
          <div key={cycle.id}><p className="[overflow-wrap:anywhere]"><strong>{cycle.name}</strong> · {cycle.objectiveCount} goals · {cycle.averageProgress === null ? "—" : `${cycle.averageProgress}%`}</p>
          {cycle.finalReflection && <p className="text-muted-foreground">{cycle.finalReflection}</p>}</div>
        ))}
        <div className="flex flex-wrap gap-2">
          {data.periodComparisons.map((comparison) => <Badge key={`${comparison.baseCycleName}-${comparison.targetCycleName}`} variant="outline" className="max-w-full min-w-0 whitespace-normal [overflow-wrap:anywhere]">
            {comparison.baseCycleName} → {comparison.targetCycleName}: {comparison.progressDelta === null ? "n/a" : comparison.progressDelta}%
          </Badge>)}
        </div>
      </CardContent></Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.totalGoals} goals</p>
        <div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <Button variant="outline" disabled={!data.pagination.hasNextPage} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
      </div>
      </>}
    </div>
  );
}
