"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "./workspace-context";

interface ImportResponse {
  error?: string;
  errors?: Array<{ row: number; reason: string }>;
  plannedObjectives?: number;
  plannedKeyResults?: number;
  committed?: boolean;
}

export function ImportExportPanel({ cycleId }: { cycleId?: string }) {
  const { isAdmin, loadWorkspace } = useWorkspace();
  const [csv, setCsv] = useState("");
  const [previewedCsv, setPreviewedCsv] = useState<string | null>(null);
  const [errors, setErrors] = useState<ImportResponse["errors"]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(dryRun: boolean) {
    setBusy(true);
    setMessage("");
    setErrors([]);
    setPreviewedCsv(null);
    try {
      const response = await fetch("/api/imports/okrs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, dryRun }),
      });
      const data: ImportResponse = await response.json();
      setErrors(data.errors);
      if (!response.ok) {
        setMessage(data.error ?? (data.errors?.length ? "Review the CSV row errors." : "The CSV could not be imported."));
      } else if (dryRun) {
        setPreviewedCsv(data.plannedObjectives ? csv : null);
        setMessage(`Preview ready: ${data.plannedObjectives ?? 0} goals, ${data.plannedKeyResults ?? 0} key results.`);
      } else if (data.committed) {
        setCsv("");
        setMessage("Goals imported.");
        await loadWorkspace();
      }
    } catch {
      setMessage(dryRun ? "The preview could not be loaded. Try again." : "The result could not be confirmed. Refresh your goals before importing again.");
    } finally {
      setBusy(false);
    }
  }

  const query = cycleId ? `?cycleId=${encodeURIComponent(cycleId)}` : "";
  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        {isAdmin ? "Import and export CSV" : "Export CSV"}
        <ChevronDown aria-hidden="true" className="size-4 group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t p-4">
        {isAdmin && (
          <>
            <Field>
              <FieldLabel htmlFor="goal-import-csv">OKR CSV</FieldLabel>
              <Textarea id="goal-import-csv" value={csv} disabled={busy} rows={6} onChange={(event) => {
                setCsv(event.target.value);
                setPreviewedCsv(null);
                setMessage("");
                setErrors([]);
              }} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || !csv.trim()} onClick={() => void submit(true)}>Preview import</Button>
              <Button disabled={busy || previewedCsv !== csv} onClick={() => void submit(false)}>Import goals</Button>
            </div>
            <p role="status" className="text-sm empty:hidden">{message}</p>
            {!!errors?.length && (
              <ul className="space-y-1 text-sm">
                {errors.map((error, index) => (
                  <li key={`${error.row}-${index}`}><strong>Row {error.row}:</strong> {error.reason}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><a href={`/api/exports/okrs${query}`}>Export OKRs</a></Button>
          <Button asChild variant="outline"><a href={`/api/exports/check-ins${query}`}>Export check-ins</a></Button>
        </div>
      </div>
    </details>
  );
}
