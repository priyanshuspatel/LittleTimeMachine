import { config, mediaUrl } from "../config";
import { buildReflectionPrompt, chooseReflectionText } from "../domain/reflection";
import type { AppDependencies } from "../ports";
import type { AcceptedPhoto } from "../services/photoUpload";
import { traced } from "../sentry";
import type { MemoryCard, MemoryRecord } from "../types";

export interface MemoryRequest {
  photo: AcceptedPhoto;
  questText: string;
  experienceText: string;
}

/**
 * Reflects on a written experience, narrates that reflection, and stores the card.
 * The photo has already been sanitized. This function does not delete it on failure;
 * the HTTP layer does, because it also owns the temporary upload.
 *
 * @param deps - Model, narrator, database, and clock.
 * @param input - Sanitized photo plus the two text fields.
 * @returns The card returned to the client. Paths inside it are public media URLs.
 */
export async function runMemoryPipeline(
  deps: Pick<AppDependencies, "textGenerator" | "speech" | "memories" | "now">,
  input: MemoryRequest,
): Promise<MemoryCard> {
  return traced("memory.process", "memory.pipeline", { "memoryquest.stage": "memory" }, async () => {
    const prompt = buildReflectionPrompt(input.questText, input.experienceText);
    const reflection = await traced(
      "llm.gemma",
      "gen_ai.request",
      {
        "gen_ai.system": "ollama",
        "gen_ai.request.model": config.ollamaModel,
        "gen_ai.operation": "reflection",
      },
      async (span) => {
        const generated = await deps.textGenerator.complete(prompt, { numPredict: 180, temperature: 0.7 });
        span.setAttribute("gen_ai.usage.input_tokens", generated.promptTokens);
        span.setAttribute("gen_ai.usage.output_tokens", generated.completionTokens);
        span.setAttribute("gen_ai.total_duration_ns", generated.totalDurationNs);
        span.setAttribute("experience.chars", input.experienceText.length);
        return generated;
      },
    );

    const reflectionText = chooseReflectionText(reflection.text);
    const speech = await traced(
      "tts.elevenlabs",
      "gen_ai.tts",
      { "gen_ai.system": "elevenlabs", "gen_ai.operation": "reflection" },
      async (span) => {
        const audio = await deps.speech.synthesize(reflectionText);
        span.setAttribute("tts.cache_hit", audio.cacheHit);
        span.setAttribute("tts.bytes", audio.bytes);
        return audio;
      },
    );

    const createdAt = deps.now();
    const record: MemoryRecord = {
      photoPath: input.photo.relativePath,
      photoUrl: mediaUrl(input.photo.relativePath),
      questText: input.questText,
      experienceText: input.experienceText,
      reflectionText,
      reflectionAudioPath: speech.relativePath,
      reflectionAudioUrl: speech.audioUrl,
      createdAt,
    };

    await traced("db.mongodb", "db.insert", { "db.system": "mongodb", "db.name": config.mongoDbName }, async () => {
      await deps.memories.save(record);
    });

    const card: MemoryCard = {
      photoUrl: record.photoUrl,
      experienceText: record.experienceText,
      reflectionText: record.reflectionText,
      reflectionAudioUrl: record.reflectionAudioUrl,
      timestamp: createdAt.toISOString(),
    };
    return card;
  });
}
