export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

export interface Session {
  id: string;
  name: string;
  scope: string[];
  createdAt: string;
  apiKey: string;
}

export interface RunRecord {
  id: string;
  sessionId: string;
  toolId: string;
  target: string;
  args: Record<string, string | number | boolean>;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  error?: string;
  command: string[];
}

export interface RunChunk {
  type: "stdout" | "stderr" | "status" | "end";
  data: string;
  ts: string;
}

export interface ToolDef {
  id: string;
  label: string;
  description: string;
  binary: string;
  category: "recon" | "scan" | "web" | "infra";
  argsSchema: ToolArgSchema[];
  buildCommand: (
    target: string,
    args: Record<string, string | number | boolean>,
  ) => string[];
}

export interface ToolArgSchema {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum";
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
  help?: string;
}
