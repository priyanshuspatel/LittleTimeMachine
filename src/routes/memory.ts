import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { config, mediaUrl } from "../config";
import { AppError } from "../errors";
import { assertPhoto, asyncHandler, experienceTextSchema, questTextSchema } from "../http";
import { traced } from "../sentry";
import { synthesizeSpeech } from "../services/elevenlabs";
import { saveMemory } from "../services/memoryRepository";
import { generateReflectionText } from "../services/ollama";
import { photoDir, ttsDir } from "../storage";
import type { MemoryCard, MemoryRecord, ProcessMemoryResponse } from "../types";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, photoDir());
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase() || extensionFor(file.mimetype);
      callback(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

function extensionFor(mime: string): string {
  return mime === "image/png" ? ".png" : ".jpg";
}

async function removeQuietly(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }
  await unlink(filePath).catch(() => undefined);
}

function requiredText(
  value: unknown,
  schema: typeof experienceTextSchema,
  code: string,
  message: string,
): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, code, message);
  }
  return parsed.data;
}

export const memoryRouter = Router();

memoryRouter.post(
  "/process",
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    const uploadedPhoto = req.file;

    try {
      const photo = assertPhoto(uploadedPhoto);
      const questText = requiredText(
        req.body?.questText,
        questTextSchema,
        "QUEST_TEXT_REQUIRED",
        "questText is required",
      );
      const experienceText = requiredText(
        req.body?.experienceText,
        experienceTextSchema,
        "EXPERIENCE_REQUIRED",
        "Describe your experience in 1 to 2000 characters",
      );

      const memoryCard = await traced(
        "memory.process",
        "memory.pipeline",
        { "memoryquest.stage": "memory" },
        async () => {
          const reflection = await traced(
            "llm.gemma",
            "gen_ai.request",
            {
              "gen_ai.system": "ollama",
              "gen_ai.request.model": config.ollamaModel,
              "gen_ai.operation": "reflection",
            },
            async (span) => {
              const generated = await generateReflectionText({ questText, experienceText });
              span.setAttribute("gen_ai.usage.input_tokens", generated.promptTokens);
              span.setAttribute("gen_ai.usage.output_tokens", generated.completionTokens);
              span.setAttribute("gen_ai.total_duration_ns", generated.totalDurationNs);
              span.setAttribute("experience.chars", experienceText.length);
              return generated;
            },
          );

          const speech = await traced(
            "tts.elevenlabs",
            "gen_ai.tts",
            { "gen_ai.system": "elevenlabs", "gen_ai.operation": "reflection" },
            async (span) => {
              const audio = await synthesizeSpeech(reflection.text, ttsDir());
              span.setAttribute("tts.cache_hit", audio.cacheHit);
              span.setAttribute("tts.bytes", audio.bytes);
              return audio;
            },
          );

          const createdAt = new Date();
          const photoRelative = path.posix.join("photos", path.basename(photo.path));

          const record: MemoryRecord = {
            photoPath: photo.path,
            photoUrl: mediaUrl(photoRelative),
            questText,
            experienceText,
            reflectionText: reflection.text,
            reflectionAudioPath: speech.relativePath,
            reflectionAudioUrl: speech.audioUrl,
            createdAt,
          };

          await traced("db.mongodb", "db.insert", { "db.system": "mongodb" }, async () => {
            await saveMemory(record);
          });

          const card: MemoryCard = {
            photoUrl: record.photoUrl,
            experienceText: record.experienceText,
            reflectionText: record.reflectionText,
            reflectionAudioUrl: record.reflectionAudioUrl,
            timestamp: createdAt.toISOString(),
          };
          return card;
        },
      );

      const body: ProcessMemoryResponse = { success: true, memoryCard };
      res.status(201).json(body);
    } catch (error) {
      await removeQuietly(uploadedPhoto?.path);
      throw error;
    }
  }),
);
