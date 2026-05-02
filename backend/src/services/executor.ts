import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import type { RunChunk } from "../types.js";

export interface Executor {
  /**
   * Spawn `binary` with `args`. Returns a handle whose `events` emits
   * "chunk" (RunChunk) and "exit" ({ code, signal, timedOut }).
   */
  spawn(binary: string, args: string[], opts?: { timeoutMs?: number }): ExecutorHandle;
}

export interface ExecutorHandle {
  events: EventEmitter;
  cancel(): void;
}

/** Real subprocess executor used in production. */
export class ProcessExecutor implements Executor {
  spawn(binary: string, args: string[], opts: { timeoutMs?: number } = {}): ExecutorHandle {
    const events = new EventEmitter();
    let proc: ChildProcessByStdio<null, Readable, Readable>;
    try {
      proc = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      queueMicrotask(() => {
        events.emit("chunk", chunk("stderr", `failed to spawn ${binary}: ${(err as Error).message}`));
        events.emit("exit", { code: null, signal: null, timedOut: false });
      });
      return { events, cancel: () => undefined };
    }

    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

    proc.stdout.on("data", (buf: Buffer) => events.emit("chunk", chunk("stdout", buf.toString("utf8"))));
    proc.stderr.on("data", (buf: Buffer) => events.emit("chunk", chunk("stderr", buf.toString("utf8"))));
    proc.on("error", (err) => events.emit("chunk", chunk("stderr", `process error: ${err.message}`)));
    proc.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      events.emit("exit", { code, signal, timedOut });
    });

    return {
      events,
      cancel: () => {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      },
    };
  }
}

/**
 * Test executor that lets you script chunks and exit code without spawning
 * a real process. Used in vitest.
 */
export class FakeExecutor implements Executor {
  constructor(
    private script: (binary: string, args: string[]) => {
      chunks: RunChunk[];
      exitCode: number;
      delayMs?: number;
      timedOut?: boolean;
    },
  ) {}

  spawn(binary: string, args: string[]): ExecutorHandle {
    const events = new EventEmitter();
    const plan = this.script(binary, args);
    let cancelled = false;

    setTimeout(() => {
      if (cancelled) return;
      for (const c of plan.chunks) events.emit("chunk", c);
      events.emit("exit", {
        code: plan.exitCode,
        signal: null,
        timedOut: plan.timedOut ?? false,
      });
    }, plan.delayMs ?? 0);

    return {
      events,
      cancel: () => {
        cancelled = true;
        events.emit("exit", { code: null, signal: "SIGTERM", timedOut: false });
      },
    };
  }
}

function chunk(type: RunChunk["type"], data: string): RunChunk {
  return { type, data, ts: new Date().toISOString() };
}
