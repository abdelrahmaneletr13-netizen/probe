import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { MemoryStore } from "../services/store.js";
import { validateTarget, TargetError } from "../services/targetGuard.js";

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  scope: z.array(z.string().min(1)).max(50).default([]),
});

export function registerSessionRoutes(
  app: FastifyInstance,
  store: MemoryStore,
  config: AppConfig,
) {
  app.post("/v1/sessions", async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }

    const validatedScope: string[] = [];
    for (const target of parsed.data.scope) {
      try {
        validatedScope.push(validateTarget(target, config));
      } catch (err) {
        if (err instanceof TargetError) {
          return reply.code(400).send({ error: "invalid_scope", target, message: err.message });
        }
        throw err;
      }
    }

    const session = store.createSession({
      name: parsed.data.name,
      scope: validatedScope,
      apiKey: req.apiKey,
    });
    return reply.code(201).send(session);
  });

  app.get("/v1/sessions", async (req) => ({
    sessions: store.listSessions(req.apiKey),
  }));

  app.get<{ Params: { id: string } }>("/v1/sessions/:id", async (req, reply) => {
    const session = store.getSession(req.params.id);
    if (!session || session.apiKey !== req.apiKey) {
      return reply.code(404).send({ error: "not_found" });
    }
    return session;
  });

  app.delete<{ Params: { id: string } }>("/v1/sessions/:id", async (req, reply) => {
    const session = store.getSession(req.params.id);
    if (!session || session.apiKey !== req.apiKey) {
      return reply.code(404).send({ error: "not_found" });
    }
    store.deleteSession(req.params.id);
    return reply.code(204).send();
  });
}
