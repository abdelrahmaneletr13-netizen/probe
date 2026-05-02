import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.js";

describe("auth", () => {
  it("rejects missing API key", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/sessions" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects unknown API key", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/sessions",
      headers: { authorization: "Bearer nope" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("allows healthz without a key", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
