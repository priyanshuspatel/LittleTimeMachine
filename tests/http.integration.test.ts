import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { createApp } from "../src/app";
import { AppError } from "../src/errors";
import { photoDir } from "../src/storage";
import { ONE_PIXEL_PNG, RecordingGenerator, RecordingMemories, RecordingSpeech, withServer } from "./support";

function testApp(options?: { rateLimitPerMinute?: number; generator?: RecordingGenerator }) {
  const generator = options?.generator ?? new RecordingGenerator();
  const speech = new RecordingSpeech();
  const memories = new RecordingMemories();
  const app = createApp({
    textGenerator: generator,
    speech,
    memories,
    now: () => new Date("2026-10-13T12:00:00.000Z"),
    rateLimitPerMinute: options?.rateLimitPerMinute ?? 1000,
  });
  return { app, generator, speech, memories };
}

describe("HTTP API", () => {
  it("reports health without requiring a live database connection", async () => {
    const { app } = testApp();
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/health`);
      const body = (await response.json()) as { ok: boolean; service: string; mongo: string };
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.service, "memoryquest-ai");
      assert.equal(body.mongo, "up");
      assert.equal(response.headers.get("x-powered-by"), null);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    });
  });

  it("rejects an invalid quest body and invalid JSON", async () => {
    const { app } = testApp();
    await withServer(app, async (base) => {
      const bad = await fetch(`${base}/api/quest/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previousMemories: "not-an-array" }),
      });
      const badBody = (await bad.json()) as { success: false; code: string };
      assert.equal(bad.status, 400);
      assert.equal(badBody.success, false);
      assert.equal(badBody.code, "INVALID_REQUEST");

      const broken = await fetch(`${base}/api/quest/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      const brokenBody = (await broken.json()) as { code: string };
      assert.equal(broken.status, 400);
      assert.equal(brokenBody.code, "INVALID_JSON");
    });
  });

  it("returns a quest from the injected model and does not leak a provider failure", async () => {
    const generator = new RecordingGenerator();
    const { app, speech } = testApp({ generator });
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/quest/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
        body: JSON.stringify({
          questIntention: "an old cricket ball",
          previousMemories: ["the red pen"],
        }),
      });
      const body = (await response.json()) as { questText: string; audioUrl: string };
      assert.equal(response.status, 200);
      assert.match(body.questText, /an old cricket ball/);
      assert.match(body.audioUrl, /\/media\/tts\/[0-9a-f]{64}\.mp3/);
      assert.equal(speech.spoken[0], body.questText);
      assert.match(generator.prompts[0], /<user_data name="intention">/);
      assert.match(generator.prompts[0], /the red pen/);
    });

    generator.failWith = new AppError(502, "OLLAMA_ERROR", "secret-stack-trace", false);
    const failing = createApp({
      textGenerator: generator,
      speech: new RecordingSpeech(),
      memories: new RecordingMemories(),
      rateLimitPerMinute: 1000,
    });
    await withServer(failing, async (base) => {
      const response = await fetch(`${base}/api/quest/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questIntention: "an old cricket ball" }),
      });
      const body = (await response.json()) as { success: false; error: string; code: string };
      assert.equal(response.status, 502);
      assert.equal(body.code, "OLLAMA_ERROR");
      assert.equal(body.error, "Request failed");
      assert.equal(body.error.includes("secret-stack-trace"), false);
    });
  });

  it("rejects a missing photo, blank writing, disguised html, and accepts a real png under a generated name", async () => {
    const { app, memories, generator } = testApp();
    await withServer(app, async (base) => {
      const missing = await fetch(`${base}/api/memory/process`, { method: "POST" });
      const missingBody = (await missing.json()) as { code: string };
      assert.equal(missing.status, 400);
      assert.equal(missingBody.code, "PHOTO_REQUIRED");

      const blank = new FormData();
      blank.append("photo", new File([ONE_PIXEL_PNG], "dot.html", { type: "text/html" }), "dot.html");
      blank.append("questText", "Find the shaded bench under the elm.");
      blank.append("experienceText", "   ");
      const blankResponse = await fetch(`${base}/api/memory/process`, { method: "POST", body: blank });
      const blankBody = (await blankResponse.json()) as { code: string };
      assert.equal(blankResponse.status, 400);
      assert.equal(blankBody.code, "EXPERIENCE_REQUIRED");

      const html = new FormData();
      html.append(
        "photo",
        new File([Buffer.from("<html><script>alert(1)</script></html>")], "photo.jpg", { type: "image/jpeg" }),
        "photo.jpg",
      );
      html.append("questText", "Find the shaded bench under the elm.");
      html.append("experienceText", "Sat under the tree where I played as a child.");
      const htmlResponse = await fetch(`${base}/api/memory/process`, { method: "POST", body: html });
      const htmlBody = (await htmlResponse.json()) as { code: string; error: string };
      assert.equal(htmlResponse.status, 415);
      assert.equal(htmlBody.code, "UNSUPPORTED_PHOTO");
      assert.equal(htmlBody.error.includes("<script>"), false);

      const good = new FormData();
      const trailed = Buffer.concat([ONE_PIXEL_PNG, Buffer.from("<script>alert(1)</script>")]);
      good.append("photo", new File([trailed], "evil.html", { type: "text/html" }), "evil.html");
      good.append("questText", "Find the shaded bench under the elm.");
      good.append("experienceText", "Sat under the tree where I played as a child.");
      const goodResponse = await fetch(`${base}/api/memory/process`, { method: "POST", body: good });
      const goodBody = (await goodResponse.json()) as {
        success: true;
        memoryCard: { photoUrl: string; experienceText: string; reflectionText: string; timestamp: string };
      };
      assert.equal(goodResponse.status, 201);
      assert.equal(goodBody.success, true);
      assert.equal(goodBody.memoryCard.experienceText, "Sat under the tree where I played as a child.");
      assert.equal(goodBody.memoryCard.timestamp, "2026-10-13T12:00:00.000Z");
      assert.match(goodBody.memoryCard.reflectionText, /This moment is kept/);
      assert.match(goodBody.memoryCard.photoUrl, /\/media\/photos\/[0-9a-f-]{36}\.png$/);
      assert.equal(memories.saved.length, 1);
      assert.match(memories.saved[0].photoPath, /^photos\/[0-9a-f-]{36}\.png$/);
      assert.equal(memories.saved[0].photoPath.includes("evil.html"), false);
      assert.match(generator.prompts.at(-1) ?? "", /<user_data name="experience">/);

      const photoPath = new URL(goodBody.memoryCard.photoUrl).pathname;
      const photo = await fetch(`${base}${photoPath}`);
      const bytes = Buffer.from(await photo.arrayBuffer());
      assert.equal(photo.status, 200);
      assert.equal(photo.headers.get("content-type"), "image/png");
      assert.equal(photo.headers.get("x-content-type-options"), "nosniff");
      assert.equal(photo.headers.get("content-security-policy"), "default-src 'none'");
      assert.deepEqual(bytes, ONE_PIXEL_PNG);

      const names = await readdir(photoDir());
      assert.equal(names.some((name) => name.endsWith(".html") || name.endsWith(".upload")), false);
    });
  });

  it("blocks a foreign origin and limits repeated API calls", async () => {
    const { app } = testApp({ rateLimitPerMinute: 2 });
    await withServer(app, async (base) => {
      const foreign = await fetch(`${base}/api/quest/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ questIntention: "an old cricket ball" }),
      });
      const foreignBody = (await foreign.json()) as { code: string };
      assert.equal(foreign.status, 403);
      assert.equal(foreignBody.code, "ORIGIN_FORBIDDEN");

      const first = await fetch(`${base}/api/quest/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questIntention: "an old cricket ball" }),
      });
      const second = await fetch(`${base}/api/quest/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questIntention: "an old cricket ball" }),
      });
      const third = await fetch(`${base}/api/quest/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questIntention: "an old cricket ball" }),
      });
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(third.status, 429);
      const limited = (await third.json()) as { code: string };
      assert.equal(limited.code, "RATE_LIMITED");
      assert.ok(Number(third.headers.get("retry-after")) >= 1);
    });
  });

  it("does not publish paths outside the generated media names", async () => {
    const { app } = testApp();
    await withServer(app, async (base) => {
      const traversal = await fetch(`${base}/media/photos/..%2f..%2fpackage.json`);
      assert.equal(traversal.status, 404);
      const html = await fetch(`${base}/media/photos/note.html`);
      assert.equal(html.status, 404);
      const missing = await fetch(`${base}/api/quest/missing`);
      const body = (await missing.json()) as { code: string };
      assert.equal(missing.status, 404);
      assert.equal(body.code, "NOT_FOUND");
    });
  });

  it("answers fifty health checks without dropping one", async () => {
    const { app } = testApp();
    await withServer(app, async (base) => {
      const responses = await Promise.all(Array.from({ length: 50 }, () => fetch(`${base}/health`)));
      assert.equal(responses.every((response) => response.status === 200), true);
    });
  });
});
