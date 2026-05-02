import type { Pool } from "pg";

/**
 * Idempotent migrations. Run on startup when DATABASE_URL is set.
 * Add new entries to the end only — never modify existing ones.
 */
const MIGRATIONS: string[] = [
  /* 001 */ `
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      scope      TEXT[] NOT NULL DEFAULT '{}',
      api_key    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,

  /* 002 */ `
    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_id     TEXT NOT NULL,
      target      TEXT NOT NULL,
      args        JSONB NOT NULL DEFAULT '{}',
      status      TEXT NOT NULL DEFAULT 'queued',
      command     TEXT[] NOT NULL,
      started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      exit_code   INT,
      error       TEXT
    );
    CREATE INDEX IF NOT EXISTS runs_session_idx ON runs (session_id);`,

  /* 003 */ `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
];

export async function runMigrations(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < MIGRATIONS.length; i++) {
      const exists = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = $1",
        ["schema_migrations"],
      );
      // once table exists, skip already-applied versions
      if (exists.rowCount && exists.rowCount > 0) {
        const applied = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [i + 1],
        );
        if (applied.rowCount && applied.rowCount > 0) continue;
      }
      await client.query(MIGRATIONS[i]!);
      // safe to insert even if table didn't exist before migration 003
      if (i + 1 <= MIGRATIONS.length) {
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
          [i + 1],
        ).catch(() => undefined);
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
