import { z } from "zod";

const EnvSchema = z.object({
  PENTEST_IDE_API_KEYS: z.string().min(1, "PENTEST_IDE_API_KEYS is required"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8787),
  MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(4),
  RUN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  REQUIRE_PUBLIC_TARGETS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  TARGET_ALLOWLIST: z.string().default(""),
  LOG_PRETTY: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export interface AppConfig {
  apiKeys: Set<string>;
  host: string;
  port: number;
  maxConcurrentRuns: number;
  runTimeoutSeconds: number;
  requirePublicTargets: boolean;
  targetAllowlist: string[];
  logPretty: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    apiKeys: new Set(
      parsed.PENTEST_IDE_API_KEYS.split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    ),
    host: parsed.HOST,
    port: parsed.PORT,
    maxConcurrentRuns: parsed.MAX_CONCURRENT_RUNS,
    runTimeoutSeconds: parsed.RUN_TIMEOUT_SECONDS,
    requirePublicTargets: parsed.REQUIRE_PUBLIC_TARGETS,
    targetAllowlist: parsed.TARGET_ALLOWLIST.split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    logPretty: parsed.LOG_PRETTY,
  };
}
