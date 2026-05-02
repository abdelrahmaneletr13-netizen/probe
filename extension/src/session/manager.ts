import type { BackendClient } from "../api/client.js";
import type { RunRecord, Session, ToolDescriptor } from "../api/types.js";

type Listener = () => void;

/**
 * In-memory cache of sessions / tools / runs that the tree views read from.
 * The manager is the single source of truth — views just subscribe.
 */
export class SessionManager {
  private sessions: Session[] = [];
  private tools: ToolDescriptor[] = [];
  private runs: RunRecord[] = [];
  private listeners = new Set<Listener>();

  constructor(private client: BackendClient) {}

  onDidChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSessions(): Session[] {
    return this.sessions;
  }
  getTools(): ToolDescriptor[] {
    return this.tools;
  }
  getRuns(): RunRecord[] {
    return this.runs;
  }

  async refresh(): Promise<void> {
    const [sessions, tools] = await Promise.all([
      this.client.listSessions(),
      this.client.listTools(),
    ]);
    this.sessions = sessions;
    this.tools = tools;

    if (sessions.length > 0) {
      const allRuns = await Promise.all(sessions.map((s) => this.client.listRuns(s.id)));
      this.runs = allRuns
        .flat()
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 100);
    } else {
      this.runs = [];
    }
    this.emit();
  }

  async createSession(input: { name: string; scope: string[] }): Promise<Session> {
    const created = await this.client.createSession(input);
    this.sessions = [created, ...this.sessions];
    this.emit();
    return created;
  }

  async deleteSession(id: string): Promise<void> {
    await this.client.deleteSession(id);
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.runs = this.runs.filter((r) => r.sessionId !== id);
    this.emit();
  }

  recordRun(run: RunRecord) {
    this.runs = [run, ...this.runs.filter((r) => r.id !== run.id)].slice(0, 100);
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}
