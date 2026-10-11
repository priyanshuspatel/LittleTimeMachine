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

export function sameOriginMedia(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
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
    return { questText: fromTheirWords, audioUrl: createCalmAudioTone() };
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

function createCalmAudioTone(): string {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const duration = 2.5;
    const sampleRate = ctx.sampleRate;
    const frameCount = sampleRate * duration;
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      // Soft gentle pentatonic chords
      const envelope = Math.sin((Math.PI * t) / duration) ** 2;
      const wave = Math.sin(2 * Math.PI * 261.63 * t) * 0.4 +
                   Math.sin(2 * Math.PI * 329.63 * t) * 0.3 +
                   Math.sin(2 * Math.PI * 392.00 * t) * 0.2;
      data[i] = wave * envelope * 0.2;
    }

    // Convert audio buffer to WAV blob URL
    const wavBlob = audioBufferToWav(buffer);
    return URL.createObjectURL(wavBlob);
  } catch {
    return "";
  }
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const data = buffer.getChannelData(0);
  const dataSize = data.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
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
      reflectionAudioUrl: createCalmAudioTone(),
      timestamp: new Date().toISOString(),
    };
  }

  const body = new FormData();
  body.append("photo", input.photo);
  body.append("questText", input.questText);
  body.append("experienceText", input.experienceText);

  const response = await fetch("/api/memory/process", { method: "POST", body });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const payload = (await response.json()) as { success: true; memoryCard: MemoryCard };
  return payload.memoryCard;
}
