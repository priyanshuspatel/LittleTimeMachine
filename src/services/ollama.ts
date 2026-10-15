import { config } from "../config";
import { AppError } from "../errors";
import type { GenerationOptions, GenerationUsage, TextGenerator } from "../ports";
import type { OllamaGenerateResponse } from "../types";

export interface OllamaClientSettings {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Talks to a local Ollama `/api/generate` endpoint.
 * Upstream bodies are logged and never copied into the client-facing error.
 */
export class OllamaTextGenerator implements TextGenerator {
  private readonly fetchImpl: typeof fetch;

  /**
   * @param settings - Base URL, model name, timeout, and an optional fetch replacement for tests.
   */
  constructor(private readonly settings: OllamaClientSettings) {
    this.fetchImpl = settings.fetchImpl ?? fetch;
  }

  /**
   * @param prompt - Prompt already built by the quest or reflection policy.
   * @param options - `num_predict` and temperature passed through to Ollama.
   */
  async complete(prompt: string, options: GenerationOptions): Promise<GenerationUsage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.settings.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.settings.model,
          prompt,
          stream: false,
          options: {
            temperature: options.temperature,
            num_predict: options.numPredict,
          },
        }),
      });
    } catch (error) {
      const aborted = isAbort(error);
      throw new AppError(
        502,
        "OLLAMA_UNAVAILABLE",
        aborted
          ? `The local model timed out after ${this.settings.timeoutMs}ms`
          : "Could not reach the local model. Is Ollama running?",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text();
      console.error(`Ollama returned ${response.status}: ${body.slice(0, 400)}`);
      throw new AppError(502, "OLLAMA_ERROR", "The local model could not complete the request");
    }

    let data: OllamaGenerateResponse;
    try {
      data = (await response.json()) as OllamaGenerateResponse;
    } catch {
      throw new AppError(502, "OLLAMA_ERROR", "The local model returned an unreadable response");
    }

    const text = data.response?.trim();
    if (!text) {
      throw new AppError(502, "OLLAMA_EMPTY", "The local model returned an empty completion");
    }

    return {
      text,
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      totalDurationNs: data.total_duration ?? 0,
      model: data.model || this.settings.model,
    };
  }
}

/**
 * Shared generator used by the production composition root.
 */
export const defaultTextGenerator = new OllamaTextGenerator({
  baseUrl: config.ollamaBaseUrl,
  model: config.ollamaModel,
  timeoutMs: config.ollamaTimeoutMs,
});
