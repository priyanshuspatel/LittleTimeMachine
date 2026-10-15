import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { mediaUrl } from "../config";
import { sanitizeUserText } from "../domain/sanitize";
import { AppError } from "../errors";
import type { SpeechResult, SpeechSynthesizer } from "../ports";

/**
 * Cache-aside narration with a single in-flight render per cache key.
 * Subclasses fetch the audio bytes. This class owns file names, atomic writes,
 * and the rule that a failed render can be retried.
 */
export abstract class FileCachedSpeechSynthesizer implements SpeechSynthesizer {
  private readonly inflight = new Map<string, Promise<SpeechResult>>();

  /**
   * @param cacheDirectory - Directory that will hold `*.mp3` files. It must already exist.
   */
  constructor(protected readonly cacheDirectory: string) {}

  /**
   * Identity mixed into the cache key. Include voice and model so a settings
   * change does not replay another voice.
   *
   * @param text - Sanitized narration text.
   */
  protected abstract cacheIdentity(text: string): string;

  /**
   * Fetches the audio bytes for `text`. Must not write the cache file.
   *
   * @param text - Sanitized narration text.
   * @returns A complete MPEG payload of at least 128 bytes.
   */
  protected abstract render(text: string): Promise<Buffer>;

  /**
   * Returns cached audio or renders it once, even when many callers ask together.
   *
   * @param text - Narration text.
   */
  async synthesize(text: string): Promise<SpeechResult> {
    const safe = sanitizeUserText(text);
    if (!safe) {
      throw new AppError(400, "EMPTY_SPEECH", "Nothing to narrate");
    }
    const filename = `${createHash("sha256").update(this.cacheIdentity(safe)).digest("hex")}.mp3`;
    const pending = this.inflight.get(filename);
    if (pending) {
      return pending;
    }
    const job = this.resolve(safe, filename);
    this.inflight.set(filename, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(filename);
    }
  }

  private async resolve(text: string, filename: string): Promise<SpeechResult> {
    const absolutePath = path.join(this.cacheDirectory, filename);
    const relativePath = `tts/${filename}`;
    try {
      const cached = await stat(absolutePath);
      if (cached.size >= 128) {
        return {
          relativePath,
          audioUrl: mediaUrl(relativePath),
          cacheHit: true,
          bytes: cached.size,
        };
      }
    } catch {
      // Cache miss, or a previous render left an unusable file.
    }

    const audio = await this.render(text);
    if (audio.length < 128) {
      throw new AppError(502, "ELEVENLABS_EMPTY", "Speech synthesis returned an empty audio file");
    }

    const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.partial`;
    try {
      await writeFile(temporaryPath, audio);
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    return {
      relativePath,
      audioUrl: mediaUrl(relativePath),
      cacheHit: false,
      bytes: audio.length,
    };
  }
}
