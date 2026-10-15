import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { AppError } from "../src/errors";
import { OllamaTextGenerator } from "../src/services/ollama";
import { ElevenLabsSpeechSynthesizer } from "../src/services/elevenlabs";
import { FileCachedSpeechSynthesizer } from "../src/services/speechCache";

const directories: string[] = [];

after(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "memoryquest-speech-"));
  directories.push(directory);
  return directory;
}

class SlowSpeech extends FileCachedSpeechSynthesizer {
  renders = 0;
  fail = false;

  constructor(directory: string) {
    super(directory);
  }

  protected cacheIdentity(text: string): string {
    return `voice\n${text}`;
  }

  protected async render(text: string): Promise<Buffer> {
    this.renders += 1;
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (this.fail) {
      throw new Error(`render failed for ${text}`);
    }
    return Buffer.alloc(180, text.charCodeAt(0) || 1);
  }
}

describe("OllamaTextGenerator", () => {
  it("returns trimmed usage from a successful body", async () => {
    const generator = new OllamaTextGenerator({
      baseUrl: "http://127.0.0.1:9",
      model: "gemma2:2b",
      timeoutMs: 1000,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: "gemma2:2b",
            response: "  hello there. ",
            done: true,
            prompt_eval_count: 3,
            eval_count: 4,
            total_duration: 9,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    const usage = await generator.complete("prompt", { numPredict: 20, temperature: 0.2 });
    assert.equal(usage.text, "hello there.");
    assert.equal(usage.promptTokens, 3);
    assert.equal(usage.completionTokens, 4);
    assert.equal(usage.totalDurationNs, 9);
    assert.equal(usage.model, "gemma2:2b");
  });

  it("hides the upstream body when Ollama returns an error", async () => {
    const generator = new OllamaTextGenerator({
      baseUrl: "http://127.0.0.1:9",
      model: "gemma2:2b",
      timeoutMs: 1000,
      fetchImpl: async () => new Response("secret-stack-trace model path /Users/private", { status: 500 }),
    });
    await assert.rejects(
      () => generator.complete("prompt", { numPredict: 20, temperature: 0.2 }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "OLLAMA_ERROR");
        assert.equal(error.message.includes("secret-stack-trace"), false);
        assert.equal(error.message.includes("/Users/private"), false);
        return true;
      },
    );
  });

  it("reports a timeout without the transport error text", async () => {
    const generator = new OllamaTextGenerator({
      baseUrl: "http://127.0.0.1:9",
      model: "gemma2:2b",
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("connect ECONNREFUSED 10.1.2.3");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });
    await assert.rejects(
      () => generator.complete("prompt", { numPredict: 20, temperature: 0.2 }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "OLLAMA_UNAVAILABLE");
        assert.match(error.message, /timed out after 20ms/);
        assert.equal(error.message.includes("ECONNREFUSED"), false);
        return true;
      },
    );
  });

  it("reports an unreachable model separately from a timeout", async () => {
    const generator = new OllamaTextGenerator({
      baseUrl: "http://127.0.0.1:9",
      model: "gemma2:2b",
      timeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    await assert.rejects(
      () => generator.complete("prompt", { numPredict: 20, temperature: 0.2 }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "OLLAMA_UNAVAILABLE");
        assert.match(error.message, /Is Ollama running/);
        return true;
      },
    );
  });

  it("rejects an empty completion and unreadable JSON", async () => {
    const empty = new OllamaTextGenerator({
      baseUrl: "http://127.0.0.1:9",
      model: "gemma2:2b",
      timeoutMs: 1000,
      fetchImpl: async () => new Response(JSON.stringify({ response: "   ", done: true }), { status: 200 }),
    });
    await assert.rejects(() => empty.complete("prompt", { numPredict: 10, temperature: 0.1 }), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "OLLAMA_EMPTY");
      return true;
    });

    const broken = new OllamaTextGenerator({
      baseUrl: "http://127.0.0.1:9",
      model: "gemma2:2b",
      timeoutMs: 1000,
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    });
    await assert.rejects(() => broken.complete("prompt", { numPredict: 10, temperature: 0.1 }), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "OLLAMA_ERROR");
      assert.equal(error.message.includes("not-json"), false);
      return true;
    });
  });
});

describe("FileCachedSpeechSynthesizer", () => {
  it("renders once for concurrent callers and serves the file on the next call", async () => {
    const directory = await tempDir();
    const speech = new SlowSpeech(directory);
    const results = await Promise.all(Array.from({ length: 25 }, () => speech.synthesize("same narration")));
    assert.equal(speech.renders, 1);
    assert.equal(new Set(results.map((result) => result.audioUrl)).size, 1);
    assert.equal(results.every((result) => result.bytes === 180), true);
    const again = await speech.synthesize("same narration");
    assert.equal(again.cacheHit, true);
    assert.equal(again.bytes, 180);
    assert.equal(speech.renders, 1);
    const names = await readdir(directory);
    assert.equal(names.some((name) => name.endsWith(".partial")), false);
    const cached = await stat(path.join(directory, names[0]));
    assert.equal(cached.size, 180);
  });

  it("does not share a flight between different texts", async () => {
    const directory = await tempDir();
    const speech = new SlowSpeech(directory);
    await Promise.all([speech.synthesize("one"), speech.synthesize("two")]);
    assert.equal(speech.renders, 2);
  });

  it("lets a later call retry after a failed render", async () => {
    const directory = await tempDir();
    const speech = new SlowSpeech(directory);
    speech.fail = true;
    await assert.rejects(() => speech.synthesize("retry me"), /render failed/);
    speech.fail = false;
    const rendered = await speech.synthesize("retry me");
    assert.equal(rendered.cacheHit, false);
    assert.equal(speech.renders, 2);
  });

  it("rejects narration that sanitizes to nothing", async () => {
    const directory = await tempDir();
    const speech = new SlowSpeech(directory);
    await assert.rejects(() => speech.synthesize(" \u0000 "), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "EMPTY_SPEECH");
      return true;
    });
  });
});

describe("ElevenLabsSpeechSynthesizer", () => {
  it("logs the provider body and returns a generic client error", async () => {
    const directory = await tempDir();
    const speech = new ElevenLabsSpeechSynthesizer({
      apiKey: "test-key",
      voiceId: "voice",
      modelId: "model",
      timeoutMs: 1000,
      directory,
      fetchImpl: async () => new Response(JSON.stringify({ detail: { message: "quota secret-key" } }), { status: 401 }),
    });
    await assert.rejects(() => speech.synthesize("Hello from the walk."), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "ELEVENLABS_ERROR");
      assert.equal(error.message, "Speech synthesis failed");
      assert.equal(error.message.includes("secret-key"), false);
      return true;
    });
  });

  it("writes the audio returned by the provider", async () => {
    const directory = await tempDir();
    const audio = Buffer.alloc(200, 7);
    const speech = new ElevenLabsSpeechSynthesizer({
      apiKey: "test-key",
      voiceId: "voice",
      modelId: "model",
      timeoutMs: 1000,
      directory,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { text: string };
        assert.equal(body.text, "Hello from the walk.");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("xi-api-key"), "test-key");
        return new Response(audio, { status: 200 });
      },
    });
    const first = await speech.synthesize("Hello from the walk.");
    assert.equal(first.cacheHit, false);
    assert.equal(first.bytes, 200);
    const stored = await readFile(path.join(directory, path.basename(first.relativePath)));
    assert.equal(stored.length, 200);
    const second = await speech.synthesize("Hello from the walk.");
    assert.equal(second.cacheHit, true);
    assert.equal(second.bytes, 200);
  });

  it("rejects an empty audio payload", async () => {
    const directory = await tempDir();
    const speech = new ElevenLabsSpeechSynthesizer({
      apiKey: "test-key",
      voiceId: "voice",
      modelId: "model",
      timeoutMs: 1000,
      directory,
      fetchImpl: async () => new Response(Buffer.alloc(8), { status: 200 }),
    });
    await assert.rejects(() => speech.synthesize("Hello from the walk."), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "ELEVENLABS_EMPTY");
      return true;
    });
  });
});
