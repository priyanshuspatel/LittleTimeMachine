import path from "node:path";
import express from "express";
import { existsSync } from "node:fs";
import * as Sentry from "@sentry/node";
import { config } from "./config";
import { createDefaultDependencies } from "./composition";
import { asyncHandler, errorHandler } from "./http";
import type { AppDependencies } from "./ports";
import { createMemoryRouter } from "./routes/memory";
import { createQuestRouter } from "./routes/quest";
import { isAllowedOrigin } from "./security/originGuard";
import { isPublicMediaPath } from "./security/mediaPath";
import { SlidingWindowRateLimiter } from "./security/rateLimit";
import { ensureUploadDirs, uploadRoot } from "./storage";

const webDist = path.resolve(process.cwd(), "web/dist");

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
};

/**
 * Builds the HTTP application.
 *
 * @param overrides - Replacements for the model, narrator, database, clock, ids, or rate limit.
 * Omitted fields use the production collaborators.
 */
export function createApp(overrides: Partial<AppDependencies> = {}): express.Express {
  ensureUploadDirs();
  const deps: AppDependencies = { ...createDefaultDependencies(), ...overrides };
  const limiter = new SlidingWindowRateLimiter(deps.rateLimitPerMinute, 60_000);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
    next();
  });
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    const origin = req.header("origin");
    if (isAllowedOrigin(origin, config.publicBaseUrl)) {
      next();
      return;
    }
    res.status(403).json({
      success: false,
      code: "ORIGIN_FORBIDDEN",
      error: "This origin is not allowed to call the API",
    });
  });
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    const decision = limiter.consume(req.socket.remoteAddress ?? "unknown");
    if (decision.allowed) {
      next();
      return;
    }
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    res.status(429).json({
      success: false,
      code: "RATE_LIMITED",
      error: "Too many requests. Try again shortly.",
    });
  });
  app.use(express.json({ limit: "1mb" }));

  app.use("/media", (req, res, next) => {
    if (!isPublicMediaPath(req.path)) {
      res.status(404).json({ success: false, code: "NOT_FOUND", error: "Media not found" });
      return;
    }
    next();
  });
  app.use(
    "/media",
    express.static(uploadRoot(), {
      dotfiles: "deny",
      fallthrough: true,
      setHeaders(res, filePath) {
        const extension = path.extname(filePath).toLowerCase();
        const type = MEDIA_TYPES[extension];
        if (type) {
          res.setHeader("Content-Type", type);
        }
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Content-Disposition", "inline");
      },
    }),
  );
  app.use("/media", (_req, res) => {
    res.status(404).json({ success: false, code: "NOT_FOUND", error: "Media not found" });
  });

  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      const mongoUp = await deps.memories.ping();
      res.status(200).json({
        ok: true,
        service: "memoryquest-ai",
        mongo: mongoUp ? "up" : "down",
      });
    }),
  );

  app.use("/api/quest", createQuestRouter(deps));
  app.use("/api/memory", createMemoryRouter(deps));
  app.use("/api", (_req, res) => {
    res.status(404).json({ success: false, code: "NOT_FOUND", error: "Not found" });
  });

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
