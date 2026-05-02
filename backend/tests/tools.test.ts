import { describe, expect, it } from "vitest";
import { TOOLS, findTool } from "../src/tools/registry.js";
import { authHeaders, buildTestApp } from "./helpers.js";

describe("tools registry", () => {
  it("exposes the canonical list", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/tools",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toHaveLength(TOOLS.length);
    await app.close();
  });

  it("nmap-quick builds a sane command", () => {
    const tool = findTool("nmap-quick")!;
    expect(tool.buildCommand("example.com", { ports: 50 })).toEqual([
      "-Pn",
      "--top-ports",
      "50",
      "-sV",
      "-T4",
      "example.com",
    ]);
  });
});
