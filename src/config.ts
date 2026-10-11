import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("gemma2:2b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  ELEVENLABS_API_KEY: z.string().min(1, "ELEVENLABS_API_KEY is required"),
  ELEVENLABS_VOICE_ID: z.string().min(1).default("21m00Tcm4TlvDq8ikWAM"),
  ELEVENLABS_MODEL_ID: z.string().min(1).default("eleven_multilingual_v2"),
  ELEVENLABS_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().min(1).default("memoryquest"),
  SENTRY_DSN: z.string().optional().default(""),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  UPLOAD_DIR: z.string().min(1).default("uploads"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const config = {
  port: parsed.data.PORT,
  publicBaseUrl: parsed.data.PUBLIC_BASE_URL.replace(/\/$/, ""),
  ollamaBaseUrl: parsed.data.OLLAMA_BASE_URL.replace(/\/$/, ""),
  ollamaModel: parsed.data.OLLAMA_MODEL,
  ollamaTimeoutMs: parsed.data.OLLAMA_TIMEOUT_MS,
  elevenLabsApiKey: parsed.data.ELEVENLABS_API_KEY,
  elevenLabsVoiceId: parsed.data.ELEVENLABS_VOICE_ID,
  elevenLabsModelId: parsed.data.ELEVENLABS_MODEL_ID,
  elevenLabsTimeoutMs: parsed.data.ELEVENLABS_TIMEOUT_MS,
  mongoUri: parsed.data.MONGODB_URI,
  mongoDbName: parsed.data.MONGODB_DB_NAME,
  sentryDsn: parsed.data.SENTRY_DSN,
  sentryTracesSampleRate: parsed.data.SENTRY_TRACES_SAMPLE_RATE,
  uploadDir: parsed.data.UPLOAD_DIR,
};

export function mediaUrl(relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, "");
  return `${config.publicBaseUrl}/media/${cleaned}`;
}
