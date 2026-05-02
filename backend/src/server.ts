import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import type { AppConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { registerAuth } from "./auth.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerToolRoutes } from "./routes/tools.js";
import { registerRunRoutes } from "./routes/runs.js";
import { DockerExecutor } from "./services/dockerExecutor.js";
import { ProcessExecutor, type Executor } from "./services/executor.js";
import { RunManager } from "./services/runManager.js";
import { MemoryStore } from "./services/store.js";
import { PgStore } from "./services/pgStore.js";

export interface BuildOptions {
  config: AppConfig;
  executor?: Executor;
  store?: MemoryStore | PgStore;
}

export interface AppContext {
  app: FastifyInstance;
  store: MemoryStore | PgStore;
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

  let store: MemoryStore | PgStore;
  if (opts.store) {
    store = opts.store;
  } else if (opts.config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.config.databaseUrl, max: 10 });
    await runMigrations(pool);
    store = new PgStore(pool);
    app.log.info("Using Postgres store");
  } else {
    store = new MemoryStore();
    app.log.info("Using in-memory store (sessions will be lost on restart; set DATABASE_URL for persistence)");
  }

  let executor: Executor;
  if (opts.executor) {
    executor = opts.executor;
  } else if (opts.config.dockerEnabled) {
    executor = new DockerExecutor(opts.config.toolsImage, opts.config.dockerSocket);
    app.log.info({ image: opts.config.toolsImage }, "Using Docker executor");
  } else {
    executor = new ProcessExecutor();
    app.log.info("Using process executor");
  }

  const runs = new RunManager(store, executor, opts.config);

  app.get("/healthz", async () => ({ status: "ok", uptime: process.uptime() }));
  app.get("/", async () => ({
    service: "pentest-ide",
    hint: "REST API under /v1/* — use the VS Code / Cursor Pentest IDE extension or curl with Bearer auth.",
  }));

  registerAuth(app, opts.config);
  registerSessionRoutes(app, store, opts.config);
  registerToolRoutes(app);
  registerRunRoutes(app, store, runs, opts.config);

  return { app, store, runs };
}
