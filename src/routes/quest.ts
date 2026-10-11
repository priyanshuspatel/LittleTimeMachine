import { Router } from "express";
import * as Sentry from "@sentry/node";
import { asyncHandler, parseGenerateQuest } from "../http";
import { traced } from "../sentry";
import { synthesizeSpeech } from "../services/elevenlabs";
import { generateQuestText } from "../services/ollama";
import { ttsDir } from "../storage";
import type { GenerateQuestResponse } from "../types";

export const questRouter = Router();

questRouter.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const input = parseGenerateQuest(req.body);

    const result = await traced(
      "quest.generate",
      "quest.pipeline",
      { "memoryquest.stage": "quest" },
      async () => {
        const completion = await generateQuestText(input);

        const speech = await traced(
          "tts.elevenlabs",
          "gen_ai.tts",
          { "gen_ai.system": "elevenlabs", "gen_ai.operation": "quest" },
          async (span) => {
            const audio = await synthesizeSpeech(completion.text, ttsDir());
            span.setAttribute("tts.cache_hit", audio.cacheHit);
            span.setAttribute("tts.bytes", audio.bytes);
            return audio;
          },
        );

        const payload: GenerateQuestResponse = {
          questText: completion.text,
          audioUrl: speech.audioUrl,
        };
        return payload;
      },
    );

    Sentry.getActiveSpan()?.setAttribute("quest.chars", result.questText.length);
    res.status(200).json(result);
  }),
);
