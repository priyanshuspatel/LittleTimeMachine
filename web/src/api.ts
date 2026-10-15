import { sameOriginMedia } from "../../src/domain/sameOriginMedia";

export { sameOriginMedia };

export interface QuestResponse {
  questText: string;
  audioUrl: string;
}

export interface MemoryCard {
  photoUrl: string;
  experienceText: string;
  reflectionText: string;
  reflectionAudioUrl: string;
  timestamp: string;
}

interface ErrorBody {
  success: false;
  error: string;
  code: string;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody;
    return body.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch("/health", { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

export async function generateQuest(options?: {
  questIntention?: string;
  userLocation?: string;
  previousMemories?: string[];
  forceDemo?: boolean;
}): Promise<QuestResponse> {
  const rawIntention = options?.questIntention?.trim() || options?.userLocation?.trim() || "An outdoor spot or keepsake reminding me of childhood";
  const intention = rawIntention.length < 3 ? `${rawIntention} nostalgia quest` : rawIntention;
  const fromTheirWords = `Near ${intention}, look closely for a detail weathered by time. Notice the texture, shadows, and subtle sounds of this spot. What forgotten memory or feeling from years past does it stir? Photograph it and record a few words for the archive.`;

  if (options?.forceDemo) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { questText: fromTheirWords, audioUrl: "" };
  }

  const response = await fetch("/api/quest/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      questIntention: intention,
      previousMemories: options?.previousMemories || undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as QuestResponse;
}

export async function processMemory(input: {
  photo: File;
  questText: string;
  experienceText: string;
  forceDemo?: boolean;
}): Promise<MemoryCard> {
  if (input.forceDemo) {
    await new Promise((r) => setTimeout(r, 1200));
    const photoUrl = URL.createObjectURL(input.photo);
    return {
      photoUrl,
      experienceText: input.experienceText,
      reflectionText: `Under the open sky, you paused long enough to genuinely witness this corner of the world. What felt ordinary transformed into a lasting anchor against the rush of the digital day. This moment is now safely kept in your living archives.`,
      reflectionAudioUrl: "",
      timestamp: new Date().toISOString(),
    };
  }

  const body = new FormData();
  body.append("photo", await normalizePhotoForUpload(input.photo));
  body.append("questText", input.questText);
  body.append("experienceText", input.experienceText);

  const response = await fetch("/api/memory/process", { method: "POST", body });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const payload = (await response.json()) as { success: true; memoryCard: MemoryCard };
  return payload.memoryCard;
}

/**
 * Redraws a photo the browser can already display into a complete baseline JPEG.
 * Phone pictures are often progressive, HEIC, or rotated only in EXIF. The seal
 * step stores the pixels, and the server drops EXIF, so the orientation has to be
 * baked in here. If the browser cannot decode the file, the original is sent on.
 */
function normalizePhotoForUpload(file: File): Promise<File> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      if (!longest) {
        resolve(file);
        return;
      }
      const scale = Math.min(1, 2560 / longest);
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(file);
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(new File([blob], "keepsake.jpg", { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.9,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    image.src = url;
  });
}
