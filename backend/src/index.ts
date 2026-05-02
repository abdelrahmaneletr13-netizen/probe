import "dotenv/config";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const { app } = await buildServer({ config });
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { host: config.host, port: config.port },
    "pentest-ide backend listening",
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", err);
  process.exit(1);
});
