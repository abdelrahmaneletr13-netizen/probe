import * as vscode from "vscode";
import type { Session, ToolDescriptor } from "../api/types.js";
import type { Severity } from "../findings/types.js";
import type { Intent } from "./types.js";

/**
 * OpenAI-compatible `/v1/chat/completions` → structured Pentest IDE intent.
 * Supports OpenAI, many proxies, and local stacks that expose the same JSON API.
 */

export interface LlmConfig {
  enabled: boolean;
  apiKey: string;
  /** Normalized …/v1 base for requests. */
  baseUrlV1: string;
  model: string;
  temperature: number;
  timeoutMs: number;
}

/** JSON shape the completion must return (validated before dispatch). */
export type LlmIntentJson =
  | {
      intent:
        | "help"
        | "status"
        | "refresh"
        | "disconnect"
        | "listSessions"
        | "listTools"
        | "listRuns"
        | "findings"
        | "noop";
    }
  | { intent: "connect"; url?: string; api_key?: string }
  | { intent: "create_session"; name: string; scope?: string[] }
  | { intent: "delete_session"; session: string }
  | { intent: "use_session"; session: string }
  | {
      intent: "run";
      tool_id: string;
      target: string;
      args?: Record<string, string | number | boolean>;
    }
  | { intent: "open_output"; index?: number }
  | { intent: "cancel_run"; index?: number }
  | { intent: "add_finding"; title: string; severity?: string; notes?: string };

export interface LlmResponseParsed {
  message?: string;
  intent?: LlmIntentJson | null;
}

const SYSTEM_PROMPT = `You operate Pentest IDE from chat (sessions, scans, listings, findings).

Return exactly one JSON object (no prose, no markdown fences).

Shape:
{"message": string|null, "intent": null | INTENT_OBJECT}

Where INTENT_OBJECT contains an "intent" string field naming the operation plus fields as below.

intent values & fields:
noop | help | status | refresh | disconnect | listSessions | listTools | listRuns | findings
{"intent":"connect","url"?:"","api_key"?:""}
{"intent":"create_session","name":"","scope"?:""}
{"intent":"delete_session","session":""}
{"intent":"use_session","session":""}
{"intent":"run","tool_id":"","target":"","args"?:{}}
{"intent":"open_output","index"?: number}
{"intent":"cancel_run","index"?: number}
{"intent":"add_finding","title":"","severity"?:"critical|high|medium|low|info","notes"?:""}

Use tool_id from AVAILABLE_TOOLS_JSON. Prefer noop with clarification if authorization or target unclear.`;

export function readLlmConfig(): LlmConfig {
  const cfg = vscode.workspace.getConfiguration("pentestIde");
  let base = (cfg.get<string>("llmApiBaseUrl") ?? "https://api.openai.com/v1").trim();
  base = base.replace(/\/+$/, "");
  if (!/\/v1$/i.test(base)) base = `${base}/v1`;
  return {
    enabled: cfg.get<boolean>("llmEnabled") ?? false,
    apiKey: cfg.get<string>("llmApiKey") ?? "",
    baseUrlV1: base,
    model: cfg.get<string>("llmModel") ?? "gpt-4o-mini",
    temperature: cfg.get<number>("llmTemperature") ?? 0.3,
    timeoutMs: Math.max(cfg.get<number>("llmTimeoutMs") ?? 60_000, 5_000),
  };
}

export async function invokeLlmPlanner(input: {
  userMessage: string;
  cfg: LlmConfig;
  tools: ToolDescriptor[];
  sessions: Session[];
  activeSessionName?: string;
  backendConfigured: boolean;
}): Promise<{ ok: true; data: LlmResponseParsed } | { ok: false; error: string }> {
  const toolsSnippet = JSON.stringify(
    input.tools.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      category: t.category,
    })),
  );
  const sessionsSnippet = JSON.stringify(
    input.sessions.map((s) => ({
      id: s.id,
      name: s.name,
      scope: s.scope,
    })),
  );
  const ctxUser = [
    `BACKEND_CONFIGURED=${input.backendConfigured}`,
    input.activeSessionName
      ? `ACTIVE_SESSION=${input.activeSessionName}`
      : "ACTIVE_SESSION=none",
    `AVAILABLE_TOOLS_JSON=${toolsSnippet}`,
    `AVAILABLE_SESSIONS_JSON=${sessionsSnippet}`,
    `USER_MESSAGE=\n${input.userMessage}`,
  ].join("\n");

  const base = input.cfg.baseUrlV1.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), input.cfg.timeoutMs);
  const jsonMode = vscode.workspace.getConfiguration("pentestIde").get<boolean>("llmResponseJsonMode") ?? true;

  try {
    const payload: Record<string, unknown> = {
      model: input.cfg.model,
      temperature: input.cfg.temperature,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: ctxUser },
      ],
    };
    if (jsonMode) payload.response_format = { type: "json_object" };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.cfg.apiKey}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify(payload),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        error: `LLM HTTP ${res.status}: ${errBody.slice(0, 400)}`,
      };
    }
    const completion = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = completion?.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseLlmEnvelope(content);
    if (!parsed) return { ok: false, error: "LLM returned unparseable JSON." };
    return { ok: true, data: parsed };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("aborted") ? "LLM request timed out." : msg };
  }
}

/** Parse `{message,intent}` and validate intent minimally. */
export function parseLlmEnvelope(raw: string): LlmResponseParsed | null {
  const trimmed = extractJsonSubset(raw.trim());
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const message = typeof obj.message === "string" ? obj.message : undefined;
    const intentBlob = obj.intent;
    if (intentBlob === null || intentBlob === undefined)
      return { message, intent: undefined };
    if (typeof intentBlob !== "object" || intentBlob === null) return null;
    const inn = intentBlob as Record<string, unknown>;
    const intentStr = inn.intent;
    if (typeof intentStr !== "string") return null;
    const base = validateIntent(intentStr, inn);
    if (!base) return null;
    return { message, intent: base };
  } catch {
    return null;
  }
}

function extractJsonSubset(s: string): string | undefined {
  if (s.startsWith("{")) {
    try {
      JSON.parse(s);
      return s;
    } catch {
      /* bracket slice */
    }
  }
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(s);
  if (fence) return fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) return s.slice(start, end + 1).trim();
  return undefined;
}

function validateIntent(
  intent: string,
  o: Record<string, unknown>,
): LlmIntentJson | null {
  switch (intent) {
    case "noop":
    case "help":
    case "status":
    case "refresh":
    case "disconnect":
    case "listSessions":
    case "listTools":
    case "listRuns":
    case "findings":
      return { intent };
    case "connect":
      return {
        intent: "connect",
        url: typeof o.url === "string" ? o.url : undefined,
        api_key: typeof o.api_key === "string" ? o.api_key : undefined,
      };
    case "create_session":
      if (typeof o.name !== "string" || !o.name.trim()) return null;
      return {
        intent: "create_session",
        name: o.name.trim(),
        scope: normalizeScope(o.scope),
      };
    case "delete_session":
    case "use_session":
      if (typeof o.session !== "string" || !o.session.trim()) return null;
      return {
        intent: intent === "delete_session" ? "delete_session" : "use_session",
        session: o.session.trim(),
      };
    case "run":
      if (typeof o.tool_id !== "string" || typeof o.target !== "string") return null;
      if (!o.tool_id.trim() || !o.target.trim()) return null;
      return {
        intent: "run",
        tool_id: o.tool_id.trim(),
        target: o.target.trim(),
        args: normalizeArgs(o.args),
      };
    case "open_output":
      return {
        intent: "open_output",
        index: normalizeIndex(o.index),
      };
    case "cancel_run":
      return {
        intent: "cancel_run",
        index: normalizeIndex(o.index),
      };
    case "add_finding":
      if (typeof o.title !== "string" || !o.title.trim()) return null;
      return {
        intent: "add_finding",
        title: o.title.trim(),
        severity: typeof o.severity === "string" ? o.severity : undefined,
        notes: typeof o.notes === "string" ? o.notes : "",
      };
    default:
      return null;
  }
}

function normalizeScope(scope: unknown): string[] | undefined {
  if (!scope) return undefined;
  if (!Array.isArray(scope)) return undefined;
  return scope.map(String).map((x) => x.trim()).filter(Boolean);
}

function normalizeArgs(
  raw: unknown,
): Record<string, string | number | boolean> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeIndex(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** Map planner JSON → internal Intent router uses. */
export function llmJsonToIntent(blob: LlmIntentJson): Intent | null {
  switch (blob.intent) {
    case "noop":
      return null;
    case "help":
      return { kind: "help" };
    case "status":
      return { kind: "status" };
    case "refresh":
      return { kind: "refresh" };
    case "disconnect":
      return { kind: "disconnect" };
    case "listSessions":
      return { kind: "listSessions" };
    case "listTools":
      return { kind: "listTools" };
    case "listRuns":
      return { kind: "listRuns" };
    case "findings":
      return { kind: "findings" };
    case "connect":
      return {
        kind: "connect",
        url: blob.url,
        apiKey: blob.api_key,
      };
    case "create_session":
      return { kind: "createSession", name: blob.name, scope: blob.scope ?? [] };
    case "delete_session":
      return { kind: "deleteSession", target: blob.session };
    case "use_session":
      return { kind: "useSession", target: blob.session };
    case "run": {
      const args: Record<string, string> = {};
      if (blob.args) {
        for (const [k, v] of Object.entries(blob.args)) args[k] = String(v);
      }
      return { kind: "run", tool: blob.tool_id, target: blob.target, args };
    }
    case "open_output":
      return { kind: "openOutput", index: blob.index };
    case "cancel_run":
      return { kind: "cancel", index: blob.index };
    case "add_finding": {
      const raw = (blob.severity ?? "info").toLowerCase();
      const allowed = ["critical", "high", "medium", "low", "info"] as const;
      const severity: Severity = (allowed as readonly string[]).includes(raw)
        ? (raw as Severity)
        : "info";
      return {
        kind: "addFinding",
        title: blob.title,
        severity,
        notes: blob.notes ?? "",
      };
    }
    default:
      return null;
  }
}
