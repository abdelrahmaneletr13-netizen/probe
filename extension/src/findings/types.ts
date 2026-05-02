export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  id: string;
  sessionId: string;
  runId: string;
  toolId: string;
  target: string;
  title: string;
  notes: string;
  severity: Severity;
  createdAt: string;
}
