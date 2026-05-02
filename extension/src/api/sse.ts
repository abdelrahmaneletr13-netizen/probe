/**
 * Tiny incremental SSE parser. Feed it chunks from a fetch body reader and it
 * emits { event, data } records as soon as full messages are available.
 *
 * Pure function so it is trivially unit-testable.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): Array<{ event: string; data: string }> {
    this.buffer += chunk;
    const events: Array<{ event: string; data: string }> = [];

    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const parsed = parseEvent(raw);
      if (parsed) events.push(parsed);
    }
    return events;
  }
}

function parseEvent(raw: string): { event: string; data: string } | undefined {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return undefined;
  return { event, data: dataLines.join("\n") };
}
