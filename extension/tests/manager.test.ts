import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/session/manager.js";
import type { BackendClient } from "../src/api/client.js";
import type { RunRecord, Session, ToolDescriptor } from "../src/api/types.js";

function fakeClient(overrides: Partial<BackendClient> = {}): BackendClient {
  return {
    listSessions: async () => sessions,
    listTools: async () => tools,
    listRuns: async () => runs,
    createSession: async (input) => ({
      id: "new",
      name: input.name,
      scope: input.scope,
      createdAt: "now",
    }),
    deleteSession: async () => undefined,
    ...overrides,
  } as unknown as BackendClient;
}

const sessions: Session[] = [{ id: "s1", name: "demo", scope: ["example.com"], createdAt: "now" }];
const tools: ToolDescriptor[] = [
  { id: "nmap-quick", label: "Nmap", description: "", category: "scan", argsSchema: [] },
];
const runs: RunRecord[] = [
  {
    id: "r1",
    sessionId: "s1",
    toolId: "nmap-quick",
    target: "example.com",
    status: "succeeded",
    startedAt: "2024-01-01T00:00:00.000Z",
    command: ["nmap"],
  },
];

describe("SessionManager", () => {
  it("hydrates sessions, tools, and runs on refresh", async () => {
    const m = new SessionManager(fakeClient());
    let fired = 0;
    m.onDidChange(() => fired++);
    await m.refresh();
    expect(m.getSessions()).toHaveLength(1);
    expect(m.getTools()).toHaveLength(1);
    expect(m.getRuns()).toHaveLength(1);
    expect(fired).toBe(1);
  });

  it("creates and deletes sessions locally without an extra refresh", async () => {
    const m = new SessionManager(fakeClient());
    await m.refresh();
    const created = await m.createSession({ name: "new", scope: [] });
    expect(m.getSessions()[0]?.id).toBe(created.id);
    await m.deleteSession(created.id);
    expect(m.getSessions().some((s) => s.id === created.id)).toBe(false);
  });

  it("recordRun deduplicates by id", async () => {
    const m = new SessionManager(fakeClient());
    await m.refresh();
    const updated: RunRecord = { ...runs[0]!, status: "running" };
    m.recordRun(updated);
    expect(m.getRuns().filter((r) => r.id === updated.id)).toHaveLength(1);
    expect(m.getRuns()[0]?.status).toBe("running");
  });
});
