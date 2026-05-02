import { EventEmitter } from "node:events";
import Dockerode from "dockerode";
import type { RunChunk } from "../types.js";
import type { Executor, ExecutorHandle } from "./executor.js";

/**
 * Runs each tool invocation in its own short-lived Docker container using the
 * pentest-ide/tools image. The container is removed on completion.
 *
 * Requires the Docker daemon socket to be accessible:
 *   - locally: /var/run/docker.sock
 *   - on Fly.io: set DOCKER_HOST to a remote socket or Fly Machines endpoint
 */
export class DockerExecutor implements Executor {
  private docker: Dockerode;

  constructor(
    private image: string = process.env.TOOLS_IMAGE ?? "pentest-ide/tools:latest",
    socketPath: string = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
  ) {
    this.docker = new Dockerode({ socketPath });
  }

  spawn(binary: string, args: string[], opts: { timeoutMs?: number } = {}): ExecutorHandle {
    const events = new EventEmitter();
    let containerId: string | undefined;
    let cancelled = false;

    const run = async () => {
      let container: Dockerode.Container | undefined;
      try {
        container = await this.docker.createContainer({
          Image: this.image,
          Cmd: [binary, ...args],
          AttachStdout: true,
          AttachStderr: true,
          HostConfig: {
            AutoRemove: false,
            NetworkMode: "bridge",
            CapDrop: ["ALL"],
            SecurityOpt: ["no-new-privileges"],
            PidsLimit: 64,
            Memory: 256 * 1024 * 1024,
          },
        });
        containerId = container.id;

        if (cancelled) {
          await container.remove({ force: true }).catch(() => undefined);
          events.emit("exit", { code: null, signal: "SIGTERM", timedOut: false });
          return;
        }

        const timeoutHandle = opts.timeoutMs
          ? setTimeout(async () => {
              events.emit("chunk", chunk("stderr", "\n[run timeout — stopping container]\n"));
              await container!.stop({ t: 5 }).catch(() => undefined);
            }, opts.timeoutMs)
          : null;

        const stream = await container.attach({ stream: true, stdout: true, stderr: true });
        const passThrough = new EventEmitter();

        container.modem.demuxStream(stream, {
          write: (buf: Buffer) => events.emit("chunk", chunk("stdout", buf.toString("utf8"))),
        } as NodeJS.WritableStream, {
          write: (buf: Buffer) => events.emit("chunk", chunk("stderr", buf.toString("utf8"))),
        } as NodeJS.WritableStream);

        await container.start();
        const result = await container.wait();
        if (timeoutHandle) clearTimeout(timeoutHandle);

        const timedOut = false;
        events.emit("exit", { code: result.StatusCode, signal: null, timedOut });
      } catch (err) {
        events.emit("chunk", chunk("stderr", `docker error: ${(err as Error).message}\n`));
        events.emit("exit", { code: null, signal: null, timedOut: false });
      } finally {
        if (container) {
          await container.remove({ force: true }).catch(() => undefined);
        }
      }
    };

    run();

    return {
      events,
      cancel: async () => {
        cancelled = true;
        if (containerId) {
          const c = this.docker.getContainer(containerId);
          await c.stop({ t: 5 }).catch(() => undefined);
        }
      },
    };
  }
}

function chunk(type: RunChunk["type"], data: string): RunChunk {
  return { type, data, ts: new Date().toISOString() };
}
