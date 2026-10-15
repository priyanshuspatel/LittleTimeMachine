import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import type { GenerationOptions, GenerationUsage, MemoryStore, SpeechResult, SpeechSynthesizer, TextGenerator } from "../src/ports";
import type { MemoryRecord } from "../src/types";

export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export class RecordingGenerator implements TextGenerator {
  readonly prompts: string[] = [];
  failWith: Error | undefined;

  async complete(prompt: string, _options: GenerationOptions): Promise<GenerationUsage> {
    this.prompts.push(prompt);
    if (this.failWith) {
      throw this.failWith;
    }
    if (prompt.includes('name="experience"')) {
      return usage(
        "You stood with what you wrote. The quest stayed tied to those words. This moment is kept.",
      );
    }
    const intention = prompt.match(/<user_data name="intention">\n([\s\S]*?)\n<\/user_data>/)?.[1] ?? "a kept thing";
    return usage(
      `Go back to ${intention} and look once. Notice one detail that is still there. What feeling remains tied to it? Photograph it and type a few words about that connection.`,
    );
  }
}

export class RecordingSpeech implements SpeechSynthesizer {
  readonly spoken: string[] = [];

  async synthesize(text: string): Promise<SpeechResult> {
    this.spoken.push(text);
    const file = `${"ab".repeat(32)}.mp3`;
    return {
      relativePath: `tts/${file}`,
      audioUrl: `http://127.0.0.1:3000/media/tts/${file}`,
      cacheHit: false,
      bytes: 256,
    };
  }
}

export class RecordingMemories implements MemoryStore {
  readonly saved: MemoryRecord[] = [];

  async save(record: MemoryRecord): Promise<void> {
    this.saved.push(record);
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

export function usage(text: string): GenerationUsage {
  return {
    text,
    promptTokens: 11,
    completionTokens: 17,
    totalDurationNs: 42,
    model: "fake",
  };
}

export async function withServer(app: Express, run: (base: string) => Promise<void>): Promise<void> {
  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
