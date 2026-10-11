import * as Sentry from "@sentry/node";
import { initSentry } from "./sentry";
import { config } from "./config";
import { closeMongo, connectMongo } from "./services/memoryRepository";
import { createApp } from "./app";

async function main(): Promise<void> {
  initSentry();
  await connectMongo();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`MemoryQuest AI listening on ${config.publicBaseUrl}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, closing`);
    server.close();
    await closeMongo();
    await Sentry.close(2000);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : "Startup failed";
  console.error(message);
  Sentry.captureException(error);
  await Sentry.close(2000);
  process.exit(1);
});
