import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { registerAuth } from "./auth.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerToolRoutes } from "./routes/tools.js";
import { registerRunRoutes } from "./routes/runs.js";
import { ProcessExecutor, type Executor } from "./services/executor.js";
import { RunManager } from "./services/runManager.js";
import { MemoryStore } from "./services/store.js";

export interface BuildOptions {
  config: AppConfig;
  executor?: Executor;
  store?: MemoryStore;
}

export interface AppContext {
  app: FastifyInstance;
  store: MemoryStore;
  runs: RunManager;
}

export async function buildServer(opts: BuildOptions): Promise<AppContext> {
  const app = Fastify({
    logger: opts.config.logPretty
      ? { transport: { target: "pino-pretty" } }
      : true,
    disableRequestLogging: false,
  });

  await app.register(sensible);
  await app.register(cors, { origin: true });

  const store = opts.store ?? new MemoryStore();
  const executor = opts.executor ?? new ProcessExecutor();
  const runs = new RunManager(store, executor, opts.config);

  app.get("/healthz", async () => ({ status: "ok", uptime: process.uptime() }));

  registerAuth(app, opts.config);
  registerSessionRoutes(app, store, opts.config);
  registerToolRoutes(app);
  registerRunRoutes(app, store, runs, opts.config);

  return { app, store, runs };
}
