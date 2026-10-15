import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { Router } from "express";
import multer from "multer";
import { AppError } from "../errors";
import { asyncHandler, experienceTextSchema, questTextSchema } from "../http";
import type { AppDependencies } from "../ports";
import { runMemoryPipeline } from "../pipelines/memoryPipeline";
import { acceptUploadedPhoto } from "../services/photoUpload";
import { photoDir } from "../storage";
import type { ProcessMemoryResponse } from "../types";

function extensionIgnoredName(): string {
  return `${randomUUID()}.upload`;
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

/**
 * Memory routes bound to the supplied collaborators.
 *
 * @param deps - Model, narrator, database, clock, and id factory.
 */
export function createMemoryRouter(deps: AppDependencies): Router {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => {
        callback(null, photoDir());
      },
      filename: (_req, _file, callback) => {
        callback(null, extensionIgnoredName());
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, fieldSize: 32 * 1024 },
  });

  const router = Router();
  router.post(
    "/process",
    upload.single("photo"),
    asyncHandler(async (req, res) => {
      const uploadedPhoto = req.file;
      let storedPath: string | undefined;
      try {
        if (!uploadedPhoto) {
          throw new AppError(400, "PHOTO_REQUIRED", "A JPEG, PNG, or WebP photo is required");
        }
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
        const photo = await acceptUploadedPhoto(uploadedPhoto, deps.createId);
        storedPath = photo.absolutePath;
        const memoryCard = await runMemoryPipeline(deps, { photo, questText, experienceText });
        const body: ProcessMemoryResponse = { success: true, memoryCard };
        res.status(201).json(body);
      } catch (error) {
        await removeQuietly(uploadedPhoto?.path);
        if (storedPath && storedPath !== uploadedPhoto?.path) {
          await removeQuietly(storedPath);
        }
        throw error;
      }
    }),
  );

  return router;
}
