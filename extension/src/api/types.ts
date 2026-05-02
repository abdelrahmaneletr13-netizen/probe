export interface Session {
  id: string;
  name: string;
  scope: string[];
  createdAt: string;
}

export interface ToolDescriptor {
  id: string;
  label: string;
  description: string;
  category: "recon" | "scan" | "web" | "infra";
  argsSchema: ToolArg[];
}

export interface ToolArg {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum";
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
  help?: string;
}

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

export interface RunRecord {
  id: string;
  sessionId: string;
  toolId: string;
  target: string;
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
