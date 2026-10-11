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

async function generate(prompt: string, numPredict = 180, temperature = 0.7): Promise<OllamaUsage> {
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
          temperature,
          num_predict: numPredict,
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

const unwanted = /\b(bench|benches|oak|elm|swing|swings|pathway|insect|bird|birds|leaves|leaf|shadows|grass|alley|riverside)\b/i;
const namedPlace = /\b(ground|school|court|route|park|lane|field|playground|road|shop|library|street|neighbourhood|neighborhood)\b/i;

function questFromTheirWords(intention: string): string {
  if (namedPlace.test(intention)) {
    return `Go to ${intention}, if you can do so safely. Spend a few quiet minutes there and notice one detail that is still the same or has changed. What feeling or memory is still tied to that place, if any? Photograph that detail and type a few words about the connection.`;
  }
  return `${intention} may still be in a storeroom, a wardrobe, a cupboard, or a drawer. Look through those places until you come across it, then pause with one small detail. What feeling, person, or time is still tied to it, if any? Photograph it and type a few words about that connection.`;
}

export async function generateQuestText(input: {
  questIntention: string;
  previousMemories?: string[];
}): Promise<OllamaUsage> {
  const intention = input.questIntention.trim();
  const place = namedPlace.test(intention);
  const avoid =
    input.previousMemories && input.previousMemories.length > 0
      ? `Do not repeat: ${input.previousMemories.join("; ")}.`
      : "";
  const prompt = [
    "Write exactly four short sentences. No title. No list.",
    `The person wants to reconnect with this: "${intention}".`,
    "The first sentence must contain those exact words.",
    place
      ? "They named a place. Invite them to go there if it is safe, notice one detail, and ask what feeling or memory is still tied to it."
      : "They named an object. Suggest it may be in a storeroom, wardrobe, cupboard, or drawer. Ask them to look there, then ask what feeling, person, or time is still tied to it.",
    "Do not tell them what they must feel. Do not say 'do not go to a park' or 'do not go outside'.",
    "The last sentence asks them to photograph it and type a few words about that connection.",
    "Do not mention a path, leaves, birds, insects, a bench, or a garden unless those words are in their request.",
    avoid,
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  const result = await generate(prompt, 220, 0.3);
  const text = takeSentences(result.text, 4);
  const missing = !text.toLowerCase().includes(intention.toLowerCase());
  const drifted = unwanted.test(text) && !unwanted.test(intention);
  return { ...result, text: missing || drifted ? questFromTheirWords(intention) : text };
}

export async function generateReflectionText(input: {
  questText: string;
  experienceText: string;
}): Promise<OllamaUsage> {
  const prompt = [
    "You write warm nostalgia reflections.",
    "Reply with exactly three sentences and nothing else. No title, no list, no quotes.",
    "The person wrote this experience themselves after the quest.",
    "Summarize what they wrote and connect it only to the quest they were given.",
    "Use only details they wrote. Do not invent people, dates, or places they did not mention.",
    `Quest: ${input.questText}`,
    `What they wrote: ${input.experienceText}`,
  ].join("\n");

  const result = await generate(prompt);
  return { ...result, text: takeSentences(result.text, 3) };
}
