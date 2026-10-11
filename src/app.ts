import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import * as Sentry from "@sentry/node";
import { errorHandler } from "./http";
import { memoryRouter } from "./routes/memory";
import { questRouter } from "./routes/quest";
import { ensureUploadDirs, uploadRoot } from "./storage";

const webDist = path.resolve(process.cwd(), "web/dist");

export function createApp(): express.Express {
  ensureUploadDirs();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use("/media", express.static(uploadRoot()));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "memoryquest-ai" });
  });

  app.use("/api/quest", questRouter);
  app.use("/api/memory", memoryRouter);

  if (existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        setHeaders(res, filePath) {
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-store");
          }
        },
      }),
    );
  }

  Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);

  return app;
}
