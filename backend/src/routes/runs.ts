import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { RunManager } from "../services/runManager.js";
import type { MemoryStore } from "../services/store.js";
import type { PgStore } from "../services/pgStore.js";
import { TargetError, validateTarget } from "../services/targetGuard.js";
import { findTool } from "../tools/registry.js";
import type { RunRecord, Session } from "../types.js";

type AnyStore = MemoryStore | PgStore;

const StartSchema = z.object({
  toolId: z.string().min(1),
  target: z.string().min(1),
  args: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export function registerRunRoutes(
  app: FastifyInstance,
  store: AnyStore,
  runs: RunManager,
  config: AppConfig,
) {
  app.post<{ Params: { id: string } }>("/v1/sessions/:id/runs", async (req, reply) => {
    const session = await store.getSession(req.params.id);
    if (!session || session.apiKey !== req.apiKey) {
      return reply.code(404).send({ error: "session_not_found" });
    }
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }

    const tool = findTool(parsed.data.toolId);
    if (!tool) return reply.code(404).send({ error: "unknown_tool" });

    let target: string;
    try {
      target = validateTarget(parsed.data.target, config);
    } catch (err) {
      if (err instanceof TargetError) {
        return reply.code(400).send({ error: "invalid_target", message: err.message });
      }
      throw err;
    }

    if (session.scope.length > 0 && !session.scope.includes(target)) {
      return reply
        .code(400)
        .send({ error: "out_of_scope", message: "Target is not in this session's scope" });
    }

    const command = [tool.binary, ...tool.buildCommand(target, parsed.data.args)];
    const record = await store.createRun({
      sessionId: session.id,
      toolId: tool.id,
      target,
      args: parsed.data.args,
      command,
    });
    const started = await runs.start(record);
    return reply.code(202).send(started);
  });

  app.get<{ Params: { id: string } }>("/v1/sessions/:id/runs", async (req, reply) => {
    const session = await store.getSession(req.params.id);
    if (!session || session.apiKey !== req.apiKey) {
      return reply.code(404).send({ error: "session_not_found" });
    }
    return { runs: await store.listRuns(session.id) };
  });

  app.get<{ Params: { id: string; runId: string } }>(
    "/v1/sessions/:id/runs/:runId",
    async (req, reply) => {
      const run = await assertOwned(req, reply, store);
      if (!run) return;
      return run;
    },
  );

  app.delete<{ Params: { id: string; runId: string } }>(
    "/v1/sessions/:id/runs/:runId",
    async (req, reply) => {
      const run = await assertOwned(req, reply, store);
      if (!run) return;
      const cancelled = runs.cancel(run.id);
      return reply.code(cancelled ? 202 : 409).send({ cancelled });
    },
  );

  app.get<{ Params: { id: string; runId: string } }>(
    "/v1/sessions/:id/runs/:runId/stream",
    async (req, reply) => {
      const run = await assertOwned(req, reply, store);
      if (!run) return;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const subscription = runs.subscribe(
        run.id,
        (chunk) => send("chunk", chunk),
        () => {
          store.getRun(run.id).then((finalRun) => {
            send("end", finalRun ?? run);
            reply.raw.end();
          });
        },
      );

      if (!subscription) {
        send("end", run);
        reply.raw.end();
        return;
      }

      req.raw.on("close", () => subscription.dispose());
    },
  );
}

async function assertOwned(
  req: { params: { id: string; runId: string }; apiKey: string },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  store: AnyStore,
): Promise<RunRecord | undefined> {
  const session: Session | undefined = await store.getSession(req.params.id);
  if (!session || session.apiKey !== req.apiKey) {
    reply.code(404).send({ error: "session_not_found" });
    return undefined;
  }
  const run: RunRecord | undefined = await store.getRun(req.params.runId);
  if (!run || run.sessionId !== session.id) {
    reply.code(404).send({ error: "run_not_found" });
    return undefined;
  }
  return run;
}
