import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { FakeExecutor } from "../src/services/executor.js";
import { authHeaders, buildTestApp, makeConfig } from "./helpers.js";

async function withSession(ctx: Awaited<ReturnType<typeof buildTestApp>>) {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: authHeaders(),
    payload: { name: "s", scope: ["example.com"] },
  });
  return res.json();
}

describe("runs", () => {
  it("starts a run and reports it as succeeded after the executor exits", async () => {
    const ctx = await buildTestApp({}, [
      { type: "stdout", data: "open ports: 80\n", ts: new Date().toISOString() },
    ]);
    const session = await withSession(ctx);

    const start = await ctx.app.inject({
      method: "POST",
      url: `/v1/sessions/${session.id}/runs`,
      headers: authHeaders(),
      payload: { toolId: "nmap-quick", target: "example.com" },
    });
    expect(start.statusCode).toBe(202);
    const run = start.json();
    expect(run.command[0]).toBe("nmap");

    await ctx.runs.whenDone(run.id);
    const fetched = await ctx.app.inject({
      method: "GET",
      url: `/v1/sessions/${session.id}/runs/${run.id}`,
      headers: authHeaders(),
    });
    expect(fetched.json().status).toBe("succeeded");
    await ctx.app.close();
  });

  it("rejects unknown tools and out-of-scope targets", async () => {
    const ctx = await buildTestApp();
    const session = await withSession(ctx);

    const badTool = await ctx.app.inject({
      method: "POST",
      url: `/v1/sessions/${session.id}/runs`,
      headers: authHeaders(),
      payload: { toolId: "no-such", target: "example.com" },
    });
    expect(badTool.statusCode).toBe(404);

    const oos = await ctx.app.inject({
      method: "POST",
      url: `/v1/sessions/${session.id}/runs`,
      headers: authHeaders(),
      payload: { toolId: "nmap-quick", target: "evil.com" },
    });
    expect(oos.statusCode).toBe(400);
    await ctx.app.close();
  });

  it("enforces concurrency cap", async () => {
    const config = makeConfig({ maxConcurrentRuns: 1 });
    const slow = new FakeExecutor(() => ({
      chunks: [],
      exitCode: 0,
      delayMs: 50,
    }));
    const { app, runs } = await buildServer({ config, executor: slow });
    const create = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: authHeaders(),
      payload: { name: "c" },
    });
    const session = create.json();

    const first = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.id}/runs`,
      headers: authHeaders(),
      payload: { toolId: "nmap-quick", target: "example.com" },
    });
    expect(first.json().status).toBe("running");

    const second = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.id}/runs`,
      headers: authHeaders(),
      payload: { toolId: "nmap-quick", target: "example.org" },
    });
    expect(second.json().status).toBe("failed");
    expect(second.json().error).toMatch(/max concurrent/);

    await runs.whenDone(first.json().id);
    await app.close();
  });
});
