import type { FastifyInstance } from "fastify";
import { TOOLS } from "../tools/registry.js";

export function registerToolRoutes(app: FastifyInstance) {
  app.get("/v1/tools", async () => ({
    tools: TOOLS.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      category: t.category,
      argsSchema: t.argsSchema,
    })),
  }));
}
