import type { MemoryRecord } from "./types";

/**
 * Token counts and the raw completion from one non-streaming model call.
 */
export interface GenerationUsage {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalDurationNs: number;
  model: string;
}

/**
 * Options that affect length and variety. They map to Ollama's request options.
 */
export interface GenerationOptions {
  numPredict: number;
  temperature: number;
}

/**
 * Local or remote text model. Implementations must not throw with upstream
 * response bodies attached to a client-visible message.
 */
export interface TextGenerator {
  /**
   * @param prompt - Fully built prompt. The caller has already delimited user data.
   * @param options - Length and temperature for this call.
   */
  complete(prompt: string, options: GenerationOptions): Promise<GenerationUsage>;
}

/**
 * One narration of a specific text, either freshly synthesized or read from cache.
 */
export interface SpeechResult {
  relativePath: string;
  audioUrl: string;
  cacheHit: boolean;
  bytes: number;
}

/**
 * Turns text into an MPEG audio URL this server can publish.
 */
export interface SpeechSynthesizer {
  /**
   * @param text - Narration text. Implementations may dedupe identical text.
   */
  synthesize(text: string): Promise<SpeechResult>;
}

/**
 * Persistence for a finished memory card.
 */
export interface MemoryStore {
  /**
   * @param record - Card to insert. Photo paths are relative media paths, not client names.
   */
  save(record: MemoryRecord): Promise<void>;
  /**
   * @returns Whether the database answered. Implementations must not throw.
   */
  ping(): Promise<boolean>;
}

/**
 * Collaborators for the HTTP application. Tests replace any of these.
 */
export interface AppDependencies {
  textGenerator: TextGenerator;
  speech: SpeechSynthesizer;
  memories: MemoryStore;
  now: () => Date;
  createId: () => string;
  rateLimitPerMinute: number;
}
