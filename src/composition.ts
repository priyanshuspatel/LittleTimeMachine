import { randomUUID } from "node:crypto";
import type { AppDependencies } from "./ports";
import { createDefaultSpeechSynthesizer } from "./services/elevenlabs";
import { MongoMemoryStore } from "./services/memoryRepository";
import { defaultTextGenerator } from "./services/ollama";
import { ttsDir } from "./storage";
import { config } from "./config";

/**
 * Wires the process-wide model, narrator, and database.
 * Callers can spread this and replace any field in tests.
 */
export function createDefaultDependencies(): AppDependencies {
  return {
    textGenerator: defaultTextGenerator,
    speech: createDefaultSpeechSynthesizer(ttsDir()),
    memories: new MongoMemoryStore(),
    now: () => new Date(),
    createId: () => randomUUID(),
    rateLimitPerMinute: config.rateLimitPerMinute,
  };
}
