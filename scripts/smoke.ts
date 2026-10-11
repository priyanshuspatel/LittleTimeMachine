import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import { takeSentences } from "../src/text";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const two = takeSentences(
  'Sure! Find the elm by the library. Sit until the shade reaches the path. Extra sentence.',
  2,
);
assert(
  two === "Find the elm by the library. Sit until the shade reaches the path.",
  two,
);

async function main(): Promise<void> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/health`);
  const healthBody = (await health.json()) as { ok: boolean };
  assert(health.status === 200 && healthBody.ok, "health failed");

  const badQuest = await fetch(`${base}/api/quest/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ previousMemories: "not-an-array" }),
  });
  const badBody = (await badQuest.json()) as { success: false; code: string };
  assert(badQuest.status === 400 && badBody.success === false, `quest validation ${badQuest.status}`);

  const missing = await fetch(`${base}/api/memory/process`, { method: "POST" });
  const missingBody = (await missing.json()) as { success: false; code: string };
  assert(missing.status === 400 && missingBody.code === "PHOTO_REQUIRED", `memory ${missing.status} ${missingBody.code}`);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const blank = new FormData();
  blank.append("photo", new Blob([png], { type: "image/png" }), "dot.png");
  blank.append("questText", "Find the shaded bench under the elm.");
  blank.append("experienceText", "   ");
  const blankResponse = await fetch(`${base}/api/memory/process`, { method: "POST", body: blank });
  const blankBody = (await blankResponse.json()) as { success: false; code: string };
  assert(
    blankResponse.status === 400 && blankBody.code === "EXPERIENCE_REQUIRED",
    `blank experience ${blankResponse.status} ${blankBody.code}`,
  );

  const written = new FormData();
  written.append("photo", new Blob([png], { type: "image/png" }), "dot.png");
  written.append("questText", "Find the shaded bench under the elm.");
  written.append("experienceText", "Sat under the tree where I played as a child.");
  const writtenResponse = await fetch(`${base}/api/memory/process`, { method: "POST", body: written });
  const writtenBody = (await writtenResponse.json()) as { success: false; code: string };
  assert(
    writtenBody.code !== "EXPERIENCE_REQUIRED" && writtenBody.code !== "PHOTO_REQUIRED",
    `written experience rejected early: ${writtenResponse.status} ${writtenBody.code}`,
  );

  server.close();
  console.log("smoke ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
