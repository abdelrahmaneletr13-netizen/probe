import { describe, expect, it } from "vitest";
import { SseParser } from "../src/api/sse.js";

describe("SseParser", () => {
  it("parses a single complete event", () => {
    const p = new SseParser();
    const out = p.push("event: chunk\ndata: hello\n\n");
    expect(out).toEqual([{ event: "chunk", data: "hello" }]);
  });

  it("buffers across pushes", () => {
    const p = new SseParser();
    expect(p.push("event: chunk\ndata: hel")).toEqual([]);
    expect(p.push("lo\n\nevent: end\ndata: bye\n\n")).toEqual([
      { event: "chunk", data: "hello" },
      { event: "end", data: "bye" },
    ]);
  });

  it("ignores comment lines and joins multi-line data", () => {
    const p = new SseParser();
    const out = p.push(": ping\nevent: chunk\ndata: line-1\ndata: line-2\n\n");
    expect(out).toEqual([{ event: "chunk", data: "line-1\nline-2" }]);
  });

  it("defaults event to 'message' when missing", () => {
    const p = new SseParser();
    const out = p.push("data: hi\n\n");
    expect(out).toEqual([{ event: "message", data: "hi" }]);
  });
});
