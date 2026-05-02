import { EventEmitter } from "node:events";
import type { AppConfig } from "../config.js";
import type { RunChunk, RunRecord, RunStatus } from "../types.js";
import type { Executor, ExecutorHandle } from "./executor.js";
import type { MemoryStore } from "./store.js";

interface ActiveRun {
  handle: ExecutorHandle;
  chunks: RunChunk[];
  emitter: EventEmitter;
  done: boolean;
}

/**
 * Coordinates run lifecycles: spawns the executor, buffers output for late
 * subscribers, enforces concurrency, and updates the store.
 */
export class RunManager {
  private active = new Map<string, ActiveRun>();
  private inFlight = 0;

  constructor(
    private store: MemoryStore,
    private executor: Executor,
    private config: AppConfig,
  ) {}

  start(run: RunRecord): RunRecord {
    if (this.inFlight >= this.config.maxConcurrentRuns) {
      const updated = this.store.updateRun(run.id, {
        status: "failed",
        error: "Server is at max concurrent runs, try again shortly",
        finishedAt: new Date().toISOString(),
      });
      return updated ?? run;
    }

    this.inFlight += 1;
    const updated = this.store.updateRun(run.id, { status: "running" }) ?? run;
    const emitter = new EventEmitter();
    const chunks: RunChunk[] = [];

    const handle = this.executor.spawn(run.command[0]!, run.command.slice(1), {
      timeoutMs: this.config.runTimeoutSeconds * 1000,
    });

    handle.events.on("chunk", (c: RunChunk) => {
      chunks.push(c);
      emitter.emit("chunk", c);
    });

    handle.events.on("exit", ({ code, timedOut }: { code: number | null; timedOut: boolean }) => {
      const status: RunStatus = timedOut
        ? "timeout"
        : code === 0
          ? "succeeded"
          : code === null
            ? "cancelled"
            : "failed";

      this.store.updateRun(run.id, {
        status,
        exitCode: code,
        finishedAt: new Date().toISOString(),
      });

      const entry = this.active.get(run.id);
      if (entry) entry.done = true;
      this.inFlight = Math.max(0, this.inFlight - 1);
      emitter.emit("end", { status, code });
    });

    this.active.set(run.id, { handle, chunks, emitter, done: false });
    return updated;
  }

  cancel(runId: string): boolean {
    const entry = this.active.get(runId);
    if (!entry || entry.done) return false;
    entry.handle.cancel();
    return true;
  }

  /**
   * Returns the buffered history plus a live subscription. Caller must invoke
   * `dispose` when they disconnect.
   */
  subscribe(runId: string, onChunk: (c: RunChunk) => void, onEnd: () => void) {
    const entry = this.active.get(runId);
    if (!entry) return undefined;
    for (const c of entry.chunks) onChunk(c);
    if (entry.done) {
      onEnd();
      return { dispose: () => undefined };
    }
    entry.emitter.on("chunk", onChunk);
    entry.emitter.once("end", onEnd);
    return {
      dispose: () => {
        entry.emitter.off("chunk", onChunk);
        entry.emitter.off("end", onEnd);
      },
    };
  }

  /** For tests: wait until a run finishes (or already has). */
  whenDone(runId: string): Promise<void> {
    const entry = this.active.get(runId);
    if (!entry || entry.done) return Promise.resolve();
    return new Promise((resolve) => entry.emitter.once("end", () => resolve()));
  }
}
