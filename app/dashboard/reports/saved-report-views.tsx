"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReportFilters, SavedReportView } from "@/lib/report-filters";

export function SavedReportViews({ filters, onApply, periodAvailable }: {
  filters: ReportFilters; onApply: (filters: ReportFilters) => void; periodAvailable: boolean;
}) {
  const [views, setViews] = useState<SavedReportView[]>([]);
  const [activeId, setActiveId] = useState("none");
  const [mode, setMode] = useState<"save" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const active = views.find(view => view.id === activeId);
  const changed = active && (Object.keys(filters) as (keyof ReportFilters)[]).some(key => filters[key] !== active.filters[key]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/report-views", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load saved views.");
      const data = await response.json();
      if (!controller.signal.aborted) setViews(data.views);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load saved views. Reload to try again.");
    });
    return () => controller.abort();
  }, []);

  function open(next: NonNullable<typeof mode>, trigger: HTMLButtonElement) {
    opener.current = trigger;
    setName(next === "rename" ? active?.name ?? "" : "");
    setError("");
    setNotice("");
    setMode(next);
  }

  async function persist(operation: "save" | "rename" | "delete" | "replace") {
    setError("");
    setNotice("");
    if ((operation === "save" || operation === "rename") && !name.trim()) {
      setError("Enter a view name.");
      nameInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(operation === "save" ? "/api/report-views" : `/api/report-views/${activeId}`, {
        method: operation === "save" ? "POST" : operation === "delete" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: operation === "delete" ? undefined : JSON.stringify(
          operation === "save" ? { name, filters } : operation === "rename" ? { name } : { filters }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error ?? "Could not update the saved view.");
        if (operation === "save" || operation === "rename") nameInput.current?.focus();
        return;
      }
      if (operation === "delete") {
        setViews(list => list.filter(view => view.id !== activeId));
        setActiveId("none");
        setNotice("Saved view deleted. The current filters are still applied.");
      } else {
        const { view } = await response.json() as { view: SavedReportView };
        setViews(list => [...list.filter(item => item.id !== view.id), view].sort((left, right) => left.name.localeCompare(right.name)));
        setActiveId(view.id);
        if (operation !== "rename") onApply(view.filters);
        setNotice(operation === "rename" ? "Saved view renamed." : "Report view saved.");
      }
      setMode(null);
    } catch {
      setError("Could not update the saved view. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <Card className="shadow-none"><CardContent className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-full min-w-0 sm:w-64">
        <Label className="mb-2" htmlFor="saved-report-view">Saved report views</Label>
        <Select value={activeId} onValueChange={id => {
          setActiveId(id); setError(""); setNotice("");
          const view = views.find(item => item.id === id);
          if (view) onApply(view.filters);
        }}>
          <SelectTrigger id="saved-report-view" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Current filters</SelectItem>
            {views.map(view => <SelectItem key={view.id} value={view.id}>{view.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2 self-end">
        <Button variant="outline" disabled={!periodAvailable || busy} onClick={event => open("save", event.currentTarget)}><Bookmark /> Save as new view</Button>
        {active && <>
          <Button variant="outline" disabled={busy} onClick={event => open("rename", event.currentTarget)}>Rename view</Button>
          <Button variant="outline" disabled={!changed || !periodAvailable || busy} onClick={() => void persist("replace")}>Replace filters</Button>
          <Button variant="ghost" disabled={busy} onClick={event => open("delete", event.currentTarget)}>Delete view</Button>
        </>}
      </div>
    </div>
    {changed && <p className="text-sm text-muted-foreground">Current filters differ from this saved view.</p>}
    {notice && <p className="text-sm" role="status">{notice}</p>}
    {error && !mode && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <Dialog open={Boolean(mode)} onOpenChange={open => { if (!open) { setMode(null); setError(""); } }}>
      <DialogContent onCloseAutoFocus={event => {
        event.preventDefault();
        const fallback = document.getElementById("saved-report-view");
        (opener.current?.isConnected ? opener.current : fallback)?.focus();
      }}>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          if (mode && !busy) void persist(mode);
        }}>
          <DialogHeader>
            <DialogTitle>{mode === "rename" ? "Rename report view" : mode === "delete" ? "Delete report view" : "Save report view"}</DialogTitle>
            <DialogDescription>{mode === "delete" ? "The view will be removed. Your current filters will stay applied." : "This view is private to you in this workspace."}</DialogDescription>
          </DialogHeader>
          {mode !== "delete" && <div className="space-y-2">
            <Label htmlFor="report-view-name">View name</Label>
            <Input id="report-view-name" ref={nameInput} maxLength={80} value={name} aria-invalid={Boolean(error)}
              aria-describedby={error ? "report-view-error" : undefined} onChange={event => { setName(event.target.value); setError(""); }} />
          </div>}
          {error && <p id="report-view-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button disabled={busy} variant={mode === "delete" ? "destructive" : "default"} type="submit">
              {mode === "delete" ? "Delete" : mode === "rename" ? "Rename" : "Save view"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </CardContent></Card>;
}
