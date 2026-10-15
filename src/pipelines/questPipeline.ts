import { config } from "../config";
import { chooseQuestText, buildQuestPrompt } from "../domain/quest";
import type { AppDependencies } from "../ports";
import { traced } from "../sentry";
import type { GenerateQuestResponse } from "../types";

export interface QuestRequest {
  questIntention: string;
  previousMemories?: string[];
}

/**
 * Builds a quest with the local model, falls back when the completion drifts,
 * and narrates the text that will actually be shown.
 *
 * @param deps - Model and narrator. Tracing wraps both calls.
 * @param input - Validated quest request.
 * @returns The quest the client should display and the narration URL.
 */
export async function runQuestPipeline(
  deps: Pick<AppDependencies, "textGenerator" | "speech">,
  input: QuestRequest,
): Promise<GenerateQuestResponse> {
  return traced("quest.generate", "quest.pipeline", { "memoryquest.stage": "quest" }, async () => {
    const prompt = buildQuestPrompt(input.questIntention, input.previousMemories ?? []);
    const completion = await traced(
      "llm.gemma",
      "gen_ai.request",
      {
        "gen_ai.system": "ollama",
        "gen_ai.request.model": config.ollamaModel,
        "gen_ai.operation": "quest",
      },
      async (span) => {
        const generated = await deps.textGenerator.complete(prompt, { numPredict: 220, temperature: 0.3 });
        span.setAttribute("gen_ai.usage.input_tokens", generated.promptTokens);
        span.setAttribute("gen_ai.usage.output_tokens", generated.completionTokens);
        span.setAttribute("gen_ai.total_duration_ns", generated.totalDurationNs);
        return generated;
      },
    );

    const questText = chooseQuestText(input.questIntention, completion.text);
    const speech = await traced(
      "tts.elevenlabs",
      "gen_ai.tts",
      { "gen_ai.system": "elevenlabs", "gen_ai.operation": "quest" },
      async (span) => {
        const audio = await deps.speech.synthesize(questText);
        span.setAttribute("tts.cache_hit", audio.cacheHit);
        span.setAttribute("tts.bytes", audio.bytes);
        return audio;
      },
    );

    const payload: GenerateQuestResponse = {
      questText,
      audioUrl: speech.audioUrl,
    };
    return payload;
  });
}
