import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { RunRecord, Session } from "../types.js";

/**
 * Postgres-backed store. Same interface as MemoryStore so server.ts can
 * swap it in transparently when DATABASE_URL is present.
 */
export class PgStore {
  constructor(private pool: Pool) {}

  async createSession(input: { name: string; scope: string[]; apiKey: string }): Promise<Session> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.pool.query(
      "INSERT INTO sessions (id, name, scope, api_key, created_at) VALUES ($1,$2,$3,$4,$5)",
      [id, input.name, input.scope, input.apiKey, now],
    );
    return { id, name: input.name, scope: input.scope, apiKey: input.apiKey, createdAt: now };
  }

  async getSession(id: string): Promise<Session | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM sessions WHERE id=$1", [id]);
    return rows[0] ? toSession(rows[0]) : undefined;
  }

  async listSessions(apiKey: string): Promise<Session[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM sessions WHERE api_key=$1 ORDER BY created_at DESC",
      [apiKey],
    );
    return rows.map(toSession);
  }

  async deleteSession(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM sessions WHERE id=$1", [id]);
    return (rowCount ?? 0) > 0;
  }

  async createRun(input: Omit<RunRecord, "id" | "startedAt" | "status">): Promise<RunRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO runs (id,session_id,tool_id,target,args,status,command,started_at)
       VALUES ($1,$2,$3,$4,$5,'queued',$6,$7)`,
      [id, input.sessionId, input.toolId, input.target, JSON.stringify(input.args), input.command, now],
    );
    return { ...input, id, startedAt: now, status: "queued" };
  }

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<RunRecord | undefined> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.status !== undefined) { sets.push(`status=$${i++}`); vals.push(patch.status); }
    if (patch.exitCode !== undefined) { sets.push(`exit_code=$${i++}`); vals.push(patch.exitCode); }
    if (patch.finishedAt !== undefined) { sets.push(`finished_at=$${i++}`); vals.push(patch.finishedAt); }
    if (patch.error !== undefined) { sets.push(`error=$${i++}`); vals.push(patch.error); }
    if (sets.length === 0) return this.getRun(id);
    vals.push(id);
    await this.pool.query(`UPDATE runs SET ${sets.join(",")} WHERE id=$${i}`, vals);
    return this.getRun(id);
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM runs WHERE id=$1", [id]);
    return rows[0] ? toRun(rows[0]) : undefined;
  }

  async listRuns(sessionId: string): Promise<RunRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM runs WHERE session_id=$1 ORDER BY started_at DESC",
      [sessionId],
    );
    return rows.map(toRun);
  }
}

function toSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    name: row.name as string,
    scope: row.scope as string[],
    apiKey: row.api_key as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toRun(row: Record<string, unknown>): RunRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    toolId: row.tool_id as string,
    target: row.target as string,
    args: row.args as Record<string, string | number | boolean>,
    status: row.status as RunRecord["status"],
    command: row.command as string[],
    startedAt: (row.started_at as Date).toISOString(),
    finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : undefined,
    exitCode: row.exit_code as number | null | undefined,
    error: row.error as string | undefined,
  };
}
