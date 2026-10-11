import * as Sentry from "@sentry/node";
import { config } from "./config";

let initialized = false;

export function initSentry(): void {
  if (initialized) {
    return;
  }

  Sentry.init({
    dsn: config.sentryDsn || undefined,
    enabled: Boolean(config.sentryDsn),
    tracesSampleRate: config.sentryTracesSampleRate,
    sendDefaultPii: false,
    integrations: [Sentry.expressIntegration()],
  });

  initialized = true;
}

// Run on import. Later calls are ignored. Express and MongoDB are only patched
// if this module is evaluated before those packages are loaded.
initSentry();

export async function traced<T>(
  name: string,
  op: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Sentry.Span) => Promise<T>,
): Promise<T> {
  return Sentry.startSpan({ name, op, attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.setStatus({ code: 2, message: "internal_error" });
      throw error;
    }
  });
}
