import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey: string;
  }
}

export function registerAuth(app: FastifyInstance, config: AppConfig) {
  app.decorateRequest("apiKey", "");

  const PUBLIC_GETS = new Set(["/healthz", "/", "/ui"]);

  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" && PUBLIC_GETS.has(req.url)) return;
    const apiKey = readApiKey(req);
    if (!apiKey || !config.apiKeys.has(apiKey)) {
      reply.code(401).send({ error: "unauthorized" });
      return reply;
    }
    req.apiKey = apiKey;
  });
}

function readApiKey(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  const x = req.headers["x-api-key"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return undefined;
}
