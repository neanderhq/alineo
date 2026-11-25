"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/okr/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CheckInQueueItem } from "@/server/check-in-queue";

export default function CheckInQueuePage() {
  const { workspace } = useWorkspace();
  return workspace && <CheckInQueue key={workspace.company.id} />;
}

function CheckInQueue() {
  const { workspace, selectedOpenCycle, canManage } = useWorkspace();
  const [selectedCycle, setSelectedCycle] = useState("");
  const [items, setItems] = useState<CheckInQueueItem[]>([]);
  const [selected, setSelected] = useState<CheckInQueueItem | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const opener = useRef<HTMLButtonElement | null>(null);
  const picker = useRef<HTMLButtonElement | null>(null);
  const cycles = workspace?.cycles.filter((cycle) => cycle.status === "open" && !cycle.archivedAt) ?? [];
  const cycleId = cycles.find((cycle) => cycle.id === selectedCycle)?.id ?? selectedOpenCycle?.id ?? cycles[0]?.id;
  const company = workspace?.company.id;

  useEffect(() => {
    if (!cycleId || !canManage) return;
    const controller = new AbortController();
    setLoading(true);
    setItems([]);
    void fetch(`/api/check-in-queue?cycleId=${cycleId}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load the queue.");
      const data = await response.json() as { items: CheckInQueueItem[] };
      if (!controller.signal.aborted) setItems(data.items);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load the queue. Try again.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [cycleId, canManage, revision, company]);

  async function act(action: "request" | "review") {
    if (!selected || !cycleId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/check-in-queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, resultId: selected.id, action, checkInId: selected.checkInId }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Could not update this result.");
        if ([403, 404, 409].includes(response.status)) {
          setSelected(null);
          setRevision(value => value + 1);
        }
        return;
      }
      if (action === "review") {
        setSelected({ ...selected, reviewed: true });
        setItems(current => current.map(item => item.id === selected.id ? { ...item, reviewed: true } : item));
        setMessage("Check-in reviewed.");
      } else {
        setMessage(result.created ? "In-app request sent." : "You already requested a check-in today.");
      }
    } catch {
      setError("Could not update this result. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const groups = Map.groupBy(items, item => item.ownerId);
  return <div className="space-y-6">
    <header>
      <h1 className="text-3xl lg:text-4xl">Check-in queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">Review key results that need attention from your direct reports.</p>
    </header>
    {!canManage ? <p>This queue is available to managers and admins.</p> : !cycleId ? <p>Open a cycle to review check-ins.</p> : <>
      <Select value={cycleId} onValueChange={value => { setSelectedCycle(value); setError(""); setMessage(""); }}>
        <SelectTrigger ref={picker} aria-label="Queue cycle" className="w-full sm:w-72"><SelectValue /></SelectTrigger>
        <SelectContent>{cycles.map(cycle => <SelectItem key={cycle.id} value={cycle.id}>{cycle.name}</SelectItem>)}</SelectContent>
      </Select>
      {error && !selected && <div role="alert" className="text-sm text-destructive">{error} <Button variant="outline" size="sm" onClick={() => { setError(""); setRevision(value => value + 1); }}>Refresh queue</Button></div>}
      {loading ? <p role="status">Loading queue…</p> : !items.length && !error && <p>No direct reports’ results need attention in this cycle.</p>}
      {[...groups].map(([ownerId, rows]) => <Card key={ownerId} className="shadow-none">
        <CardHeader><CardTitle>{rows[0].ownerName}</CardTitle></CardHeader>
        <CardContent><ul className="divide-y">
          {rows.map(item => <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1 basis-52 space-y-2">
              <p className="break-words font-semibold">{item.title}</p>
              <p className="break-words text-sm text-muted-foreground">{item.goalTitle} · {Number(item.progress)}%</p>
              <div className="flex flex-wrap gap-2">
                {item.stale && <Badge variant="secondary">Check-in overdue</Badge>}
                {item.risk && <Badge variant="outline">{item.risk === "at_risk" ? "At risk" : "Off track"}</Badge>}
                {item.reviewed && <Badge variant="secondary">Reviewed</Badge>}
              </div>
            </div>
            <Button variant="outline" aria-label={`Review ${item.title}`} onClick={event => { opener.current = event.currentTarget; setSelected(item); setError(""); setMessage(""); }}>Review</Button>
          </li>)}
        </ul></CardContent>
      </Card>)}
    </>}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}>
      {selected && <DialogContent className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => {
        event.preventDefault();
        (opener.current?.isConnected ? opener.current : picker.current)?.focus();
      }}>
        <DialogHeader>
          <DialogTitle className="break-words">{selected.title}</DialogTitle>
          <DialogDescription className="break-words">{selected.goalTitle} · {selected.ownerName}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">{Number(selected.progress)}% complete · Last effective check-in {selected.lastEffectiveDate ?? "not yet posted"}</p>
        <Button asChild variant="link" className="w-fit px-0"><Link href={`/dashboard/goals?goal=${selected.goalId}`}>Open goal</Link></Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          {selected.checkInId && <Button variant="secondary" disabled={busy || selected.reviewed} onClick={() => void act("review")}>{selected.reviewed ? "Reviewed" : "Mark reviewed"}</Button>}
          <Button disabled={busy} onClick={() => void act("request")}>Request check-in</Button>
        </DialogFooter>
      </DialogContent>}
    </Dialog>
  </div>;
}
