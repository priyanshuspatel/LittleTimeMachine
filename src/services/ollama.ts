import { config } from "../config";
import { AppError } from "../errors";
import type { OllamaGenerateResponse } from "../types";
import { takeSentences } from "../text";

export interface OllamaUsage {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalDurationNs: number;
}

async function generate(prompt: string): Promise<OllamaUsage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);

  let response: Response;
  try {
    response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 180,
        },
      }),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AppError(
      502,
      "OLLAMA_UNAVAILABLE",
      aborted
        ? `Ollama timed out after ${config.ollamaTimeoutMs}ms`
        : "Could not reach Ollama. Is it running on OLLAMA_BASE_URL?",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(
      502,
      "OLLAMA_ERROR",
      `Ollama returned ${response.status}: ${body.slice(0, 400)}`,
    );
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  const text = data.response?.trim();
  if (!text) {
    throw new AppError(502, "OLLAMA_EMPTY", "Ollama returned an empty completion");
  }

  return {
    text,
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
    totalDurationNs: data.total_duration ?? 0,
  };
}

export async function generateQuestText(input: {
  userLocation?: string;
  previousMemories?: string[];
}): Promise<OllamaUsage> {
  const location = input.userLocation?.trim() || "the neighborhood outside their door";
  const memories =
    input.previousMemories && input.previousMemories.length > 0
      ? input.previousMemories.map((item) => `- ${item}`).join("\n")
      : "None yet.";

  const prompt = [
    "You write short outdoor nostalgia quests.",
    "Reply with exactly two sentences and nothing else. No title, no list, no quotes.",
    "Send the person outside to find one physical spot, such as a shaded bench, a swing set, an overgrown wall, or a specific tree.",
    "The spot should feel findable on a walk, and the tone should be warm and specific.",
    `Place hint: ${location}`,
    `Earlier memories:\n${memories}`,
  ].join("\n");

  const result = await generate(prompt);
  return { ...result, text: takeSentences(result.text, 2) };
}

export async function generateReflectionText(input: {
  questText: string;
  experienceText: string;
}): Promise<OllamaUsage> {
  const prompt = [
    "You write warm nostalgia reflections.",
    "Reply with exactly three sentences and nothing else. No title, no list, no quotes.",
    "The person wrote this experience themselves after going outside.",
    "Summarize what they wrote and connect it to the outdoor spot in the quest.",
    "Use only details they wrote. Do not invent people, dates, or places they did not mention.",
    `Quest: ${input.questText}`,
    `What they wrote: ${input.experienceText}`,
  ].join("\n");

  const result = await generate(prompt);
  return { ...result, text: takeSentences(result.text, 3) };
}
