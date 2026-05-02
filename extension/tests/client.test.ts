import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendClient, BackendError } from "../src/api/client.js";

const ORIGINAL_FETCH = globalThis.fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("BackendClient", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.useRealTimers();
  });

  it("listSessions sends the bearer token and returns parsed body", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.url = url;
      seen.init = init;
      return jsonResponse({ sessions: [{ id: "1", name: "x", scope: [], createdAt: "now" }] });
    }) as typeof fetch;

    const client = new BackendClient({ baseUrl: "https://api.example.com", apiKey: "k" });
    const sessions = await client.listSessions();
    expect(sessions).toHaveLength(1);
    expect(seen.url).toBe("https://api.example.com/v1/sessions");
    expect((seen.init?.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("throws BackendError for 4xx responses", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "invalid_target", message: "nope" }, { status: 400 })) as typeof fetch;

    const client = new BackendClient({ baseUrl: "https://api.example.com", apiKey: "k" });
    await expect(client.listSessions()).rejects.toMatchObject({
      name: "BackendError",
      status: 400,
      code: "invalid_target",
    });
  });

  it("startRun posts the expected body", async () => {
    let captured: unknown;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string);
      return jsonResponse({
        id: "r1",
        sessionId: "s1",
        toolId: "nmap-quick",
        target: "example.com",
        status: "running",
        startedAt: "now",
        command: ["nmap"],
      });
    }) as typeof fetch;

    const client = new BackendClient({ baseUrl: "https://api.example.com", apiKey: "k" });
    const run = await client.startRun({
      sessionId: "s1",
      toolId: "nmap-quick",
      target: "example.com",
      args: { ports: 50 },
    });
    expect(run.id).toBe("r1");
    expect(captured).toEqual({
      toolId: "nmap-quick",
      target: "example.com",
      args: { ports: 50 },
    });
  });
});
