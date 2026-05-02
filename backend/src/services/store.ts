import { randomUUID } from "node:crypto";
import type { RunRecord, Session } from "../types.js";

/**
 * In-memory store. Returns Promises so it can be swapped for PgStore without
 * touching any call sites.
 */
export class MemoryStore {
  private sessions = new Map<string, Session>();
  private runs = new Map<string, RunRecord>();

  async createSession(input: { name: string; scope: string[]; apiKey: string }): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      name: input.name,
      scope: input.scope,
      apiKey: input.apiKey,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async listSessions(apiKey: string): Promise<Session[]> {
    return [...this.sessions.values()].filter((s) => s.apiKey === apiKey);
  }

  async deleteSession(id: string): Promise<boolean> {
    for (const run of this.runs.values()) {
      if (run.sessionId === id) this.runs.delete(run.id);
    }
    return this.sessions.delete(id);
  }

  async createRun(input: Omit<RunRecord, "id" | "startedAt" | "status">): Promise<RunRecord> {
    const run: RunRecord = {
      ...input,
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      status: "queued",
    };
    this.runs.set(run.id, run);
    return run;
  }

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<RunRecord | undefined> {
    const run = this.runs.get(id);
    if (!run) return undefined;
    const next = { ...run, ...patch };
    this.runs.set(id, next);
    return next;
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return this.runs.get(id);
  }

  async listRuns(sessionId: string): Promise<RunRecord[]> {
    return [...this.runs.values()].filter((r) => r.sessionId === sessionId);
  }
}
