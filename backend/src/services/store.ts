import { randomUUID } from "node:crypto";
import type { RunRecord, Session } from "../types.js";

/**
 * In-memory store. Swap for Postgres/Redis later — the interface is small on
 * purpose so a real backend can be plugged in without touching the routes.
 */
export class MemoryStore {
  private sessions = new Map<string, Session>();
  private runs = new Map<string, RunRecord>();

  createSession(input: { name: string; scope: string[]; apiKey: string }): Session {
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

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  listSessions(apiKey: string): Session[] {
    return [...this.sessions.values()].filter((s) => s.apiKey === apiKey);
  }

  deleteSession(id: string): boolean {
    for (const run of this.runs.values()) {
      if (run.sessionId === id) this.runs.delete(run.id);
    }
    return this.sessions.delete(id);
  }

  createRun(input: Omit<RunRecord, "id" | "startedAt" | "status">): RunRecord {
    const run: RunRecord = {
      ...input,
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      status: "queued",
    };
    this.runs.set(run.id, run);
    return run;
  }

  updateRun(id: string, patch: Partial<RunRecord>): RunRecord | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    const next = { ...run, ...patch };
    this.runs.set(id, next);
    return next;
  }

  getRun(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  listRuns(sessionId: string): RunRecord[] {
    return [...this.runs.values()].filter((r) => r.sessionId === sessionId);
  }
}
