import { config } from "../config";
import { AppError } from "../errors";
import { FileCachedSpeechSynthesizer } from "./speechCache";

export interface ElevenLabsSettings {
  apiKey: string;
  voiceId: string;
  modelId: string;
  timeoutMs: number;
  directory: string;
  fetchImpl?: typeof fetch;
}

interface ElevenLabsErrorBody {
  detail?: { message?: string } | string | Array<{ msg?: string }>;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function elevenLabsDetail(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as ElevenLabsErrorBody;
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
    // The body was not JSON. The slice below is for the server log only.
  }
  return raw.slice(0, 400) || response.statusText;
}

/**
 * ElevenLabs text-to-speech with a file cache keyed by voice, model, and text.
 */
export class ElevenLabsSpeechSynthesizer extends FileCachedSpeechSynthesizer {
  private readonly fetchImpl: typeof fetch;

  /**
   * @param settings - API key, voice, model, timeout, cache directory, and optional fetch.
   */
  constructor(private readonly settings: ElevenLabsSettings) {
    super(settings.directory);
    this.fetchImpl = settings.fetchImpl ?? fetch;
  }

  protected cacheIdentity(text: string): string {
    return `${this.settings.voiceId}\n${this.settings.modelId}\n${text}`;
  }

  protected async render(text: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.settings.voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": this.settings.apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          signal: controller.signal,
          body: JSON.stringify({
            text,
            model_id: this.settings.modelId,
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
      const aborted = isAbort(error);
      throw new AppError(
        502,
        "ELEVENLABS_UNAVAILABLE",
        aborted
          ? `Speech synthesis timed out after ${this.settings.timeoutMs}ms`
          : "Could not reach the speech service",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await elevenLabsDetail(response);
      console.error(`ElevenLabs returned ${response.status}: ${detail}`);
      throw new AppError(502, "ELEVENLABS_ERROR", "Speech synthesis failed");
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

/**
 * Production narrator. The cache directory is the TTS upload folder.
 */
export function createDefaultSpeechSynthesizer(directory: string): ElevenLabsSpeechSynthesizer {
  return new ElevenLabsSpeechSynthesizer({
    apiKey: config.elevenLabsApiKey,
    voiceId: config.elevenLabsVoiceId,
    modelId: config.elevenLabsModelId,
    timeoutMs: config.elevenLabsTimeoutMs,
    directory,
  });
}
