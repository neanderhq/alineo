import type { Confidence } from "@/app/types";

export const MAX_BATCH_RESULTS = 20;
export const checkInConfidenceLabels: Record<Confidence, string> = {
  on_track: "On track", at_risk: "At risk", off_track: "Off track",
};

export type BatchPreviewRow = {
  id: string; title: string; value: number; progress: number; confidence: Confidence; wouldBeCurrent: boolean;
};

export type BatchRowIssue = { id: string; message: string };
