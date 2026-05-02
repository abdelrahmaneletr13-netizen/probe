import { describe, expect, it } from "vitest";
import { llmJsonToIntent, parseLlmEnvelope } from "../src/chat/llm.js";

describe("parseLlmEnvelope", () => {
  it("parses strict JSON", () => {
    const p = parseLlmEnvelope(
      '{"message":"ok","intent":{"intent":"listTools"}}',
    );
    expect(p?.message).toBe("ok");
    expect(p?.intent).toEqual({ intent: "listTools" });
  });

  it("strips markdown fences", () => {
    const p = parseLlmEnvelope("```json\n{\"intent\":{\"intent\":\"noop\"}}\n```");
    expect(p?.intent).toEqual({ intent: "noop" });
  });
});

describe("llmJsonToIntent", () => {
  it("maps run", () => {
    expect(
      llmJsonToIntent({
        intent: "run",
        tool_id: "nmap-quick",
        target: "10.0.0.1",
        args: { x: 1 },
      }),
    ).toEqual({
      kind: "run",
      tool: "nmap-quick",
      target: "10.0.0.1",
      args: { x: "1" },
    });
  });

  it("maps noop to null", () => {
    expect(llmJsonToIntent({ intent: "noop" })).toBeNull();
  });
});
