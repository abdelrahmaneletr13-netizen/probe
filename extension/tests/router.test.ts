import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/chat/router.js";

describe("parseIntent", () => {
  it("recognises single-word shortcuts", () => {
    expect(parseIntent("help")).toEqual({ kind: "help" });
    expect(parseIntent("?")).toEqual({ kind: "help" });
    expect(parseIntent("status")).toEqual({ kind: "status" });
    expect(parseIntent("refresh")).toEqual({ kind: "refresh" });
    expect(parseIntent("sessions")).toEqual({ kind: "listSessions" });
    expect(parseIntent("tools")).toEqual({ kind: "listTools" });
    expect(parseIntent("runs")).toEqual({ kind: "listRuns" });
    expect(parseIntent("findings")).toEqual({ kind: "findings" });
  });

  it("strips leading slashes (slash-command style)", () => {
    expect(parseIntent("/help")).toEqual({ kind: "help" });
    expect(parseIntent("//tools")).toEqual({ kind: "listTools" });
  });

  it("parses connect with url and api key", () => {
    expect(parseIntent("connect http://localhost:8787 secret")).toEqual({
      kind: "connect",
      url: "http://localhost:8787",
      apiKey: "secret",
    });
    expect(parseIntent("connect http://localhost:8787")).toEqual({
      kind: "connect",
      url: "http://localhost:8787",
      apiKey: undefined,
    });
    expect(parseIntent("connect")).toEqual({ kind: "connect" });
  });

  it("parses natural-language create session", () => {
    expect(parseIntent("Create a new session named acme-engagement")).toEqual({
      kind: "createSession",
      name: "acme-engagement",
      scope: [],
    });
    expect(
      parseIntent(
        "create session acme with scope example.com, 203.0.113.10",
      ),
    ).toEqual({
      kind: "createSession",
      name: "acme",
      scope: ["example.com", "203.0.113.10"],
    });
  });

  it("parses run intent with target preposition", () => {
    expect(parseIntent("Run nmap-quick against 10.0.0.1")).toEqual({
      kind: "run",
      tool: "nmap-quick",
      target: "10.0.0.1",
      args: {},
    });
    expect(parseIntent("run httpx example.com timeout=10")).toEqual({
      kind: "run",
      tool: "httpx",
      target: "example.com",
      args: { timeout: "10" },
    });
  });

  it("parses use/select session", () => {
    expect(parseIntent("use acme")).toEqual({
      kind: "useSession",
      target: "acme",
    });
    expect(parseIntent("select session foo-bar")).toEqual({
      kind: "useSession",
      target: "foo-bar",
    });
  });

  it("parses output and cancel", () => {
    expect(parseIntent("open output for the last run")).toEqual({
      kind: "openOutput",
      index: undefined,
    });
    expect(parseIntent("output 3")).toEqual({
      kind: "openOutput",
      index: 3,
    });
    expect(parseIntent("cancel last run")).toEqual({
      kind: "cancel",
      index: undefined,
    });
    expect(parseIntent("cancel 2")).toEqual({
      kind: "cancel",
      index: 2,
    });
  });

  it("parses show recent runs natural language", () => {
    expect(parseIntent("show recent runs")).toEqual({ kind: "listRuns" });
    expect(parseIntent("list sessions")).toEqual({ kind: "listSessions" });
    expect(parseIntent("show tools")).toEqual({ kind: "listTools" });
  });

  it("parses add finding with severity", () => {
    expect(
      parseIntent('add finding "open admin panel" sev=high notes=details'),
    ).toEqual({
      kind: "addFinding",
      title: "open admin panel",
      severity: "high",
      notes: "details",
    });
    expect(parseIntent("add finding tomcat exposed")).toEqual({
      kind: "addFinding",
      title: "tomcat exposed",
      severity: "info",
      notes: "",
    });
  });

  it("returns unknown for gibberish", () => {
    expect(parseIntent("xyzzy plover")).toEqual({ kind: "unknown" });
  });
});
