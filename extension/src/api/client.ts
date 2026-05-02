import { SseParser } from "./sse.js";
import type { RunChunk, RunRecord, Session, ToolDescriptor } from "./types.js";

export interface BackendConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class BackendError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/**
 * HTTP client for the Pentest IDE backend. Uses global `fetch` (Node 18+ /
 * VS Code 1.85+) so no extra dependency is needed.
 */
export class BackendClient {
  constructor(private cfg: BackendConfig) {}

  update(cfg: BackendConfig) {
    this.cfg = cfg;
  }

  get baseUrl(): string {
    return this.cfg.baseUrl;
  }

  async ping(): Promise<boolean> {
    const res = await this.request("GET", "/healthz", { auth: false });
    return res.ok;
  }

  async listSessions(): Promise<Session[]> {
    const json = await this.json<{ sessions: Session[] }>("GET", "/v1/sessions");
    return json.sessions;
  }

  async createSession(input: { name: string; scope: string[] }): Promise<Session> {
    return this.json<Session>("POST", "/v1/sessions", { body: input });
  }

  async deleteSession(id: string): Promise<void> {
    await this.request("DELETE", `/v1/sessions/${encodeURIComponent(id)}`);
  }

  async listTools(): Promise<ToolDescriptor[]> {
    const json = await this.json<{ tools: ToolDescriptor[] }>("GET", "/v1/tools");
    return json.tools;
  }

  async listRuns(sessionId: string): Promise<RunRecord[]> {
    const json = await this.json<{ runs: RunRecord[] }>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/runs`,
    );
    return json.runs;
  }

  async startRun(input: {
    sessionId: string;
    toolId: string;
    target: string;
    args: Record<string, string | number | boolean>;
  }): Promise<RunRecord> {
    return this.json<RunRecord>("POST", `/v1/sessions/${encodeURIComponent(input.sessionId)}/runs`, {
      body: { toolId: input.toolId, target: input.target, args: input.args },
    });
  }

  async cancelRun(sessionId: string, runId: string): Promise<void> {
    await this.request("DELETE", `/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`);
  }

  async streamRun(
    sessionId: string,
    runId: string,
    handlers: {
      onChunk: (c: RunChunk) => void;
      onEnd: (run: RunRecord) => void;
      onError?: (err: Error) => void;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    const url = `${this.cfg.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/stream`;
    const res = await fetch(url, {
      headers: this.headers(),
      signal: handlers.signal,
    });
    if (!res.ok || !res.body) {
      throw await this.toError(res);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const events = parser.push(decoder.decode(value, { stream: true }));
        for (const evt of events) {
          if (evt.event === "chunk") {
            handlers.onChunk(JSON.parse(evt.data) as RunChunk);
          } else if (evt.event === "end") {
            handlers.onEnd(JSON.parse(evt.data) as RunRecord);
            return;
          }
        }
      }
    } catch (err) {
      handlers.onError?.(err as Error);
      throw err;
    }
  }

  private async json<T>(
    method: string,
    path: string,
    init: { body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const res = await this.request(method, path, init);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async request(
    method: string,
    path: string,
    init: { body?: unknown; auth?: boolean } = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.cfg.timeoutMs ?? 15_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(init.auth === false ? {} : this.headers()),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok && res.status !== 204) {
        throw await this.toError(res);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.cfg.apiKey}` };
  }

  private async toError(res: Response): Promise<BackendError> {
    let code = "http_error";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body.error) code = body.error;
      if (body.message) message = body.message;
      else if (body.error) message = body.error;
    } catch {
      /* non-JSON body */
    }
    return new BackendError(res.status, code, message);
  }
}
