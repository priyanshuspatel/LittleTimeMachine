import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectImage } from "../domain/imageInspection";
import { AppError } from "../errors";
import { photoDir } from "../storage";

export interface AcceptedPhoto {
  absolutePath: string;
  relativePath: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
}

const GENERATED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

/**
 * Replaces an upload with a sanitized image under a server-generated name.
 * The original filename and the declared MIME type are ignored.
 * On success the temporary upload is removed. On failure it is left for the caller to remove.
 *
 * @param file - Multer's disk upload, or undefined when the field was absent.
 * @param createId - UUID factory. The id becomes the published filename.
 * @returns The stored photo. `relativePath` is safe to publish under `/media`.
 */
export async function acceptUploadedPhoto(
  file: Express.Multer.File | undefined,
  createId: () => string,
): Promise<AcceptedPhoto> {
  if (!file) {
    throw new AppError(400, "PHOTO_REQUIRED", "A JPEG, PNG, or WebP photo is required");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new AppError(413, "PHOTO_TOO_LARGE", "Photo must be 10 MB or smaller");
  }

  let raw: Buffer;
  try {
    raw = await readFile(file.path);
  } catch {
    throw new AppError(400, "PHOTO_REQUIRED", "The uploaded photo could not be read");
  }

  const inspected = inspectImage(raw);
  if (!inspected.ok) {
    if (inspected.reason === "dimensions") {
      throw new AppError(413, "PHOTO_TOO_LARGE", "Photo dimensions are outside the supported range");
    }
    if (inspected.reason === "unknown") {
      throw new AppError(415, "UNSUPPORTED_PHOTO", "Photo must be a JPEG, PNG, or WebP image");
    }
    throw new AppError(400, "PHOTO_INVALID", "Photo file is not a complete image");
  }

  const filename = `${createId()}${inspected.extension}`;
  if (!GENERATED_NAME.test(filename)) {
    throw new AppError(500, "PHOTO_NAME", "Could not assign a safe photo name", false);
  }

  const absolutePath = path.join(photoDir(), filename);
  try {
    await writeFile(absolutePath, inspected.bytes);
  } catch {
    await unlink(absolutePath).catch(() => undefined);
    throw new AppError(500, "PHOTO_STORE", "Could not store the photo", false);
  }

  if (path.resolve(absolutePath) !== path.resolve(file.path)) {
    await unlink(file.path).catch(() => undefined);
  }

  return {
    absolutePath,
    relativePath: `photos/${filename}`,
    mimeType: inspected.mimeType,
    bytes: inspected.bytes.length,
  };
}
