"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { Confidence, Cycle, KeyResult } from "@/app/types";
import { useWorkspace } from "@/components/okr/workspace-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_BATCH_RESULTS, checkInConfidenceLabels, type BatchPreviewRow, type BatchRowIssue } from "@/lib/check-in-batch";

type Draft = { value: string; confidence: Confidence; version: number };
type Submission = {
  cycleId: string;
  effectiveDate: string;
  rows: Array<{ id: string; value: number; confidence: Confidence; version: number }>;
};
type Preview = { submission: Submission; rows: BatchPreviewRow[]; requestId: string };

function initialDate(cycle?: Cycle) {
  if (!cycle) return "";
  const today = new Date().toISOString().slice(0, 10);
  return today < cycle.startDate ? cycle.startDate : today > cycle.endDate ? cycle.endDate : today;
}

export default function BatchCheckInsPage() {
  const { workspace } = useWorkspace();
  return workspace && <BatchCheckIns key={workspace.company.id} />;
}

function BatchCheckIns() {
  const { workspace, selectedOpenCycle, loadWorkspace } = useWorkspace();
  const cycles = workspace?.cycles.filter(item => item.status === "open" && !item.archivedAt) ?? [];
  const startingCycle = cycles.find(item => item.id === selectedOpenCycle?.id) ?? cycles[0];
  const [cycleId, setCycleId] = useState(startingCycle?.id ?? "");
  const cycle = cycles.find(item => item.id === cycleId);
  const [effectiveDate, setEffectiveDate] = useState(() => initialDate(startingCycle));
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryError, setRetryError] = useState("");
  const [issues, setIssues] = useState<BatchRowIssue[]>([]);
  const [status, setStatus] = useState("");
  const previewButton = useRef<HTMLButtonElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const groups = cycle?.objectives.filter(goal => goal.status === "active" && !goal.archivedAt)
    .map(goal => ({ id: goal.id, title: goal.title, results: goal.keyResults.filter(result => result.canCheckIn) }))
    .filter(goal => goal.results.length) ?? [];
  const currentResults = new Map(groups.flatMap(goal => goal.results.map(result => [result.id, result] as const)));
  const selectedIds = Object.keys(draft);
  const unavailable = selectedIds.filter(id => !currentResults.has(id));

  function clearFeedback() {
    setError("");
    setIssues([]);
    setStatus("");
  }

  function toggleRow(result: KeyResult, included: boolean) {
    clearFeedback();
    setDraft(current => {
      if (included) return { ...current, [result.id]: { value: String(Number(result.current)), confidence: result.confidence, version: result.version } };
      const next = { ...current };
      delete next[result.id];
      return next;
    });
  }

  function updateRow(id: string, change: Partial<Draft>) {
    setIssues(current => current.filter(issue => issue.id !== id));
    setDraft(current => ({ ...current, [id]: { ...current[id], ...change } }));
  }

  async function requestPreview(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    if (!cycle || !effectiveDate || effectiveDate < cycle.startDate || effectiveDate > cycle.endDate) {
      setError("Choose an effective date within the selected cycle.");
      dateInput.current?.focus();
      return;
    }
    const invalid = selectedIds.filter(id => !draft[id].value.trim() || !Number.isFinite(Number(draft[id].value)));
    if (invalid.length) {
      setIssues(invalid.map(id => ({ id, message: "Enter a valid value." })));
      document.getElementById(`batch-value-${invalid[0]}`)?.focus();
      return;
    }
    const submission = {
      cycleId,
      effectiveDate,
      rows: selectedIds.map(id => ({
        id, value: Number(draft[id].value), confidence: draft[id].confidence, version: draft[id].version,
      })),
    };
    setBusy(true);
    try {
      const response = await fetch("/api/check-in-batches", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...submission, action: "preview" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not preview the batch.");
        setIssues(data.rows ?? []);
        if ([403, 404, 409].includes(response.status)) await refreshDraft();
        return;
      }
      setPreview({ submission, rows: data.rows, requestId: crypto.randomUUID() });
    } catch {
      setError("Could not preview the batch. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshDraft() {
    try {
      await loadWorkspace();
    } catch {
      setError("Could not refresh the results. Try previewing again to reconnect.");
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setRetryError("");
    try {
      const response = await fetch("/api/check-in-batches", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...preview.submission, action: "commit", requestId: preview.requestId }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status >= 500) {
          setRetryError("Could not confirm the result. Retry this same submission.");
          return;
        }
        setError(data.error ?? "Could not confirm the batch. Preview the draft again.");
        setIssues(data.rows ?? []);
        setPreview(null);
        await refreshDraft();
        return;
      }
      setDraft({});
      setStatus(`Saved ${data.receipt.count} ${data.receipt.count === 1 ? "check-in" : "check-ins"}.`);
      setPreview(null);
      await refreshDraft();
    } catch {
      setRetryError("Could not confirm the result. Retry this same submission.");
    } finally {
      setBusy(false);
    }
  }

  function acceptCurrentVersions() {
    setDraft(current => Object.fromEntries(Object.entries(current).flatMap(([id, row]) => {
      const result = currentResults.get(id);
      return result ? [[id, { ...row, version: result.version }]] : [];
    })));
    clearFeedback();
  }

  const needsReview = unavailable.length > 0 || selectedIds.some(id => {
    const result = currentResults.get(id);
    return result && result.version !== draft[id].version;
  });
  const canPreview = Boolean(cycle && selectedIds.length && !needsReview && !busy);

  return <div className="space-y-6">
    <header className="space-y-1">
      <Button asChild variant="link" className="h-auto p-0"><Link href="/dashboard/goals">Back to goals</Link></Button>
      <h1 className="text-3xl lg:text-4xl">Batch check-ins</h1>
      <p className="text-sm text-muted-foreground">Update up to {MAX_BATCH_RESULTS} key results in one open cycle.</p>
    </header>
    {cycles.length === 0 && !selectedIds.length ? <p>Open a cycle to post check-ins.</p> : <form onSubmit={requestPreview} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="batch-cycle">Batch cycle</Label>
          <Select value={cycleId} disabled={busy || selectedIds.length > 0} onValueChange={id => {
            setCycleId(id); setEffectiveDate(initialDate(cycles.find(item => item.id === id))); clearFeedback();
          }}>
            <SelectTrigger id="batch-cycle" className="w-full"><SelectValue placeholder="Choose a cycle" /></SelectTrigger>
            <SelectContent>{cycles.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="batch-date">Effective date</Label>
          <Input id="batch-date" ref={dateInput} type="date" min={cycle?.startDate} max={cycle?.endDate}
            disabled={busy || !cycle} value={effectiveDate} onChange={event => { setEffectiveDate(event.target.value); clearFeedback(); }} />
        </div>
      </div>
      {needsReview && <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <p>{unavailable.length ? `${unavailable.length} selected ${unavailable.length === 1 ? "result is" : "results are"} no longer available. ` : ""}
          Review the current values before previewing again. Eligible draft edits will be kept.</p>
        <Button type="button" variant="outline" onClick={acceptCurrentVersions}>Use current versions</Button>
      </div>}
      {cycle && !groups.length && <p>No results you can check in on are available in this cycle.</p>}
      {groups.map(goal => <Card key={goal.id} className="shadow-none">
        <CardContent>
          <h2 className="break-words text-lg font-semibold">{goal.title}</h2>
          <ul className="mt-2 divide-y">
            {goal.results.map(result => {
              const row = draft[result.id];
              const issue = issues.find(item => item.id === result.id);
              const checkId = `batch-include-${result.id}`;
              const valueId = `batch-value-${result.id}`;
              const confidenceId = `batch-confidence-${result.id}`;
              const issueId = `batch-issue-${result.id}`;
              return <li key={result.id} className="grid gap-3 py-3 sm:grid-cols-2 sm:last:pb-0">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-start gap-2">
                    <Checkbox id={checkId} className="mt-0.5" checked={Boolean(row)} disabled={busy || (!row && selectedIds.length >= MAX_BATCH_RESULTS)}
                      onCheckedChange={checked => toggleRow(result, checked === true)} />
                    <Label className="block break-words leading-snug" htmlFor={checkId}><span className="sr-only">Include </span>{result.title}</Label>
                  </div>
                  <p className="break-words pl-6 text-sm text-muted-foreground">
                    Current {Number(result.current).toLocaleString()} · Target {Number(result.target).toLocaleString()} {result.unit}
                  </p>
                </div>
                {row && <div className="grid min-w-0 grid-cols-2 items-start gap-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor={valueId}>Value<span className="sr-only"> for {result.title}</span></Label>
                    {result.metricType === "binary" ?
                      <Select value={row.value} disabled={busy} onValueChange={value => updateRow(result.id, { value })}>
                        <SelectTrigger id={valueId} className="w-full" aria-invalid={Boolean(issue)} aria-describedby={issue ? issueId : undefined}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="0">No</SelectItem><SelectItem value="1">Yes</SelectItem></SelectContent>
                      </Select> :
                      <Input id={valueId} type="number" step="any" value={row.value} disabled={busy} aria-invalid={Boolean(issue)}
                        aria-describedby={issue ? issueId : undefined} onChange={event => updateRow(result.id, { value: event.target.value })} />}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor={confidenceId}>Confidence<span className="sr-only"> for {result.title}</span></Label>
                    <Select value={row.confidence} disabled={busy} onValueChange={value => updateRow(result.id, { confidence: value as Confidence })}>
                      <SelectTrigger id={confidenceId} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(checkInConfidenceLabels).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {issue && <p id={issueId} role="alert" className="col-span-2 text-sm text-destructive">{issue.message}</p>}
                </div>}
              </li>;
            })}
          </ul>
        </CardContent>
      </Card>)}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" ref={previewButton} disabled={!canPreview}>{busy && !preview ? "Working…" : "Preview batch"}</Button>
        <span className="text-sm text-muted-foreground">{selectedIds.length} of {MAX_BATCH_RESULTS} selected</span>
        {selectedIds.length > 0 && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setDraft({}); clearFeedback(); }}>Clear draft</Button>}
      </div>
      {error && <p role="alert" ref={feedback} tabIndex={-1} className="text-sm text-destructive">{error}</p>}
      {status && <p role="status" ref={feedback} tabIndex={-1} className="text-sm">{status}</p>}
    </form>}
    <Dialog open={Boolean(preview)} onOpenChange={open => {
      if (!open && !busy && !retryError) setPreview(null);
    }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!busy && !retryError}
        onCloseAutoFocus={event => {
          event.preventDefault();
          (feedback.current ?? (canPreview ? previewButton.current : dateInput.current))?.focus();
        }}>
        <DialogHeader>
          <DialogTitle>Preview batch check-ins</DialogTitle>
          <DialogDescription>Check the values for {preview?.submission.effectiveDate}. Confirm to post all {preview?.rows.length} together.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border px-3">
          {preview?.rows.map(row => <li className="min-w-0 py-3 text-sm" key={row.id}>
            <p className="break-words font-medium">{row.title}</p>
            <p>{row.value.toLocaleString()} · {row.progress}% progress · {checkInConfidenceLabels[row.confidence]}</p>
            <p className="text-muted-foreground">{row.wouldBeCurrent ? "Updates current value" : "History only"}</p>
          </li>)}
        </ul>
        {retryError && <p role="alert" className="text-sm text-destructive">{retryError}</p>}
        <DialogFooter>
          {!retryError && <Button type="button" variant="outline" disabled={busy} onClick={() => setPreview(null)}>Cancel preview</Button>}
          <Button type="button" disabled={busy} onClick={() => void confirm()}>{busy ? "Confirming…" : retryError ? "Retry confirmation" : "Confirm check-ins"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
