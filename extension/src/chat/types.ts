import type { Severity } from "../findings/types.js";

export type Intent =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "connect"; url?: string; apiKey?: string }
  | { kind: "disconnect" }
  | { kind: "refresh" }
  | { kind: "listSessions" }
  | { kind: "listTools" }
  | { kind: "listRuns" }
  | { kind: "createSession"; name: string; scope: string[] }
  | { kind: "deleteSession"; target: string }
  | { kind: "useSession"; target: string }
  | {
      kind: "run";
      tool: string;
      target: string;
      args: Record<string, string>;
    }
  | { kind: "openOutput"; index?: number }
  | { kind: "cancel"; index?: number }
  | { kind: "findings" }
  | {
      kind: "addFinding";
      title: string;
      severity: Severity;
      notes: string;
    }
  | { kind: "resetDemo" }
  | { kind: "unknown" };
