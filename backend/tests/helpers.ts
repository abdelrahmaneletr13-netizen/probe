import { buildServer, type AppContext } from "../src/server.js";
import type { AppConfig } from "../src/config.js";
import { FakeExecutor } from "../src/services/executor.js";
import type { RunChunk } from "../src/types.js";

export const TEST_API_KEY = "test-api-key";

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    apiKeys: new Set([TEST_API_KEY]),
    host: "127.0.0.1",
    port: 0,
    maxConcurrentRuns: 4,
    runTimeoutSeconds: 30,
    requirePublicTargets: false,
    targetAllowlist: [],
    logPretty: false,
    ...overrides,
  };
}

export async function buildTestApp(
  cfg: Partial<AppConfig> = {},
  scriptedChunks: RunChunk[] = [
    { type: "stdout", data: "scan-output\n", ts: new Date().toISOString() },
  ],
  exitCode = 0,
): Promise<AppContext> {
  const config = makeConfig(cfg);
  const executor = new FakeExecutor(() => ({
    chunks: scriptedChunks,
    exitCode,
  }));
  return buildServer({ config, executor });
}

export function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TEST_API_KEY}` };
}
