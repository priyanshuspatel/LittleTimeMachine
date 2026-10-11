import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { AppError, isAppError } from "./errors";
import type { ErrorResponse } from "./types";

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

const generateQuestSchema = z.object({
  questIntention: z.string().trim().min(3).max(300),
  previousMemories: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
});

export function parseGenerateQuest(body: unknown) {
  const parsed = generateQuestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new AppError(400, "INVALID_REQUEST", message);
  }
  return parsed.data;
}

export const questTextSchema = z.string().trim().min(1).max(2000);

export const experienceTextSchema = z.string().trim().min(1).max(2000);

const allowedPhoto = new Set(["image/jpeg", "image/png"]);

export function assertPhoto(photo: Express.Multer.File | undefined): Express.Multer.File {
  if (!photo) {
    throw new AppError(400, "PHOTO_REQUIRED", "A JPEG or PNG photo is required");
  }
  if (!allowedPhoto.has(photo.mimetype)) {
    throw new AppError(415, "UNSUPPORTED_PHOTO", "Photo must be JPEG or PNG");
  }
  if (photo.size > 10 * 1024 * 1024) {
    throw new AppError(413, "PHOTO_TOO_LARGE", "Photo must be 10 MB or smaller");
  }
  return photo;
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const body: ErrorResponse = {
      success: false,
      code: error.code,
      error: error.code === "LIMIT_FILE_SIZE" ? "Upload exceeds the 10 MB limit" : error.message,
    };
    res.status(status).json(body);
    return;
  }

  if (isAppError(error)) {
    const body: ErrorResponse = {
      success: false,
      code: error.code,
      error: error.expose ? error.message : "Request failed",
    };
    res.status(error.status).json(body);
    return;
  }

  const body: ErrorResponse = {
    success: false,
    code: "INTERNAL_ERROR",
    error: "Something went wrong while processing the request",
  };
  res.status(500).json(body);
}
