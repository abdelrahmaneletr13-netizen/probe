import { describe, expect, it } from "vitest";
import { authHeaders, buildTestApp } from "./helpers.js";

describe("sessions", () => {
  it("creates, lists, fetches, and deletes a session", async () => {
    const { app } = await buildTestApp();

    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: authHeaders(),
      payload: { name: "demo", scope: ["example.com"] },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json();
    expect(session.scope).toEqual(["example.com"]);

    const list = await app.inject({
      method: "GET",
      url: "/v1/sessions",
      headers: authHeaders(),
    });
    expect(list.json().sessions).toHaveLength(1);

    const fetched = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.id}`,
      headers: authHeaders(),
    });
    expect(fetched.statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/sessions/${session.id}`,
      headers: authHeaders(),
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.id}`,
      headers: authHeaders(),
    });
    expect(after.statusCode).toBe(404);

    await app.close();
  });

  it("rejects malformed scope entries", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: authHeaders(),
      payload: { name: "bad", scope: ["not a host"] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("scopes session listing per API key", async () => {
    const { app } = await buildTestApp({
      apiKeys: new Set(["key-a", "key-b"]),
    });

    await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: "Bearer key-a" },
      payload: { name: "a-only" },
    });
    const listB = await app.inject({
      method: "GET",
      url: "/v1/sessions",
      headers: { authorization: "Bearer key-b" },
    });
    expect(listB.json().sessions).toHaveLength(0);
    await app.close();
  });
});
