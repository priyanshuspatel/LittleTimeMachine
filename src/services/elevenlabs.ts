import { createHash } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, mediaUrl } from "../config";
import { AppError } from "../errors";

export interface SpeechResult {
  relativePath: string;
  audioUrl: string;
  cacheHit: boolean;
  bytes: number;
}

function cacheName(text: string): string {
  const hash = createHash("sha256")
    .update(`${config.elevenLabsVoiceId}\n${config.elevenLabsModelId}\n${text}`)
    .digest("hex");
  return `${hash}.mp3`;
}

async function elevenLabsError(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as {
      detail?: { message?: string } | string | Array<{ msg?: string }>;
    };
    if (typeof parsed.detail === "string") {
      return parsed.detail;
    }
    if (Array.isArray(parsed.detail)) {
      return parsed.detail.map((item) => item.msg ?? "validation error").join("; ");
    }
    if (parsed.detail && typeof parsed.detail === "object" && parsed.detail.message) {
      return parsed.detail.message;
    }
  } catch {
    // Fall through to the raw body.
  }
  return raw.slice(0, 400) || response.statusText;
}

export async function synthesizeSpeech(text: string, directory: string): Promise<SpeechResult> {
  const filename = cacheName(text);
  const absolutePath = path.join(directory, filename);
  const relativePath = `tts/${filename}`;

  try {
    await access(absolutePath);
    return {
      relativePath,
      audioUrl: mediaUrl(relativePath),
      cacheHit: true,
      bytes: 0,
    };
  } catch {
    // Cache miss. Synthesize below.
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.elevenLabsTimeoutMs);

  let response: Response;
  try {
    response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenLabsVoiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": config.elevenLabsApiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          model_id: config.elevenLabsModelId,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
        }),
      },
    );
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AppError(
      502,
      "ELEVENLABS_UNAVAILABLE",
      aborted
        ? `ElevenLabs timed out after ${config.elevenLabsTimeoutMs}ms`
        : "Could not reach the ElevenLabs API",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await elevenLabsError(response);
    throw new AppError(502, "ELEVENLABS_ERROR", `ElevenLabs returned ${response.status}: ${detail}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 128) {
    throw new AppError(502, "ELEVENLABS_EMPTY", "ElevenLabs returned an empty audio file");
  }

  await writeFile(absolutePath, audio);

  return {
    relativePath,
    audioUrl: mediaUrl(relativePath),
    cacheHit: false,
    bytes: audio.length,
  };
}
