import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config";

const root = path.resolve(config.uploadDir);

export function uploadRoot(): string {
  return root;
}

export function photoDir(): string {
  return path.join(root, "photos");
}

export function ttsDir(): string {
  return path.join(root, "tts");
}

export function ensureUploadDirs(): void {
  for (const directory of [photoDir(), ttsDir()]) {
    mkdirSync(directory, { recursive: true });
  }
}
