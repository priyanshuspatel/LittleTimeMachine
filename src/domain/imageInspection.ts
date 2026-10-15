const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_METADATA = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
const WEBP_METADATA = new Set(["EXIF", "XMP "]);
const MAX_EDGE = 16_384;
const MAX_PIXELS = 80_000_000;

export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface InspectedImage {
  ok: true;
  mimeType: ImageMimeType;
  extension: ".jpg" | ".png" | ".webp";
  /** Bytes rewritten without metadata chunks and without anything after the image end. */
  bytes: Buffer;
  width: number;
  height: number;
}

export interface RejectedImage {
  ok: false;
  reason: "unknown" | "corrupt" | "dimensions";
}

/**
 * Identifies a photo from its bytes, drops metadata and trailing payload, and
 * refuses files that are not a complete JPEG, PNG, or WebP container.
 * Pixel re-encoding is intentionally not done here: this process does not link
 * an image decoder. The stored file is the container we parsed, nothing after it.
 *
 * @param input - The raw upload. Size must already have been capped by the server.
 * @returns A sanitized image, or a reason the upload cannot be stored.
 */
export function inspectImage(input: Buffer): InspectedImage | RejectedImage {
  if (input.length < 12) {
    return { ok: false, reason: "unknown" };
  }
  if (input.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return finish(parsePng(input), "image/png", ".png");
  }
  if (input[0] === 0xff && input[1] === 0xd8) {
    return finish(parseJpeg(input), "image/jpeg", ".jpg");
  }
  if (input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP") {
    return finish(parseWebp(input), "image/webp", ".webp");
  }
  return { ok: false, reason: "unknown" };
}

function finish(
  parsed: { ok: true; bytes: Buffer; width: number; height: number } | { ok: false; reason: "corrupt" | "dimensions" },
  mimeType: ImageMimeType,
  extension: ".jpg" | ".png" | ".webp",
): InspectedImage | RejectedImage {
  if (!parsed.ok) {
    return parsed;
  }
  if (mimeType !== "image/webp" && !dimensionsFit(parsed.width, parsed.height)) {
    return { ok: false, reason: "dimensions" };
  }
  return { ok: true, mimeType, extension, bytes: parsed.bytes, width: parsed.width, height: parsed.height };
}

function dimensionsFit(width: number, height: number): boolean {
  if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE) {
    return false;
  }
  return width * height <= MAX_PIXELS;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(
  input: Buffer,
): { ok: true; bytes: Buffer; width: number; height: number } | { ok: false; reason: "corrupt" | "dimensions" } {
  let offset = 8;
  const kept: Buffer[] = [PNG_SIGNATURE];
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawPixels = false;
  let sawEnd = false;

  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (length > input.length || crcEnd > input.length) {
      return { ok: false, reason: "corrupt" };
    }
    const type = input.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      return { ok: false, reason: "corrupt" };
    }
    const actual = crc32(input.subarray(offset + 4, dataEnd));
    if (actual !== input.readUInt32BE(dataEnd)) {
      return { ok: false, reason: "corrupt" };
    }
    if (type === "IHDR") {
      if (sawHeader || length < 13) {
        return { ok: false, reason: "corrupt" };
      }
      width = input.readUInt32BE(dataStart);
      height = input.readUInt32BE(dataStart + 4);
      sawHeader = true;
    }
    if (!sawHeader) {
      return { ok: false, reason: "corrupt" };
    }
    const chunk = input.subarray(offset, crcEnd);
    if (type === "IEND") {
      kept.push(chunk);
      sawEnd = true;
      break;
    }
    if (type === "IDAT") {
      sawPixels = true;
    }
    if (!PNG_METADATA.has(type)) {
      kept.push(chunk);
    }
    offset = crcEnd;
  }

  if (!sawHeader || !sawPixels || !sawEnd) {
    return { ok: false, reason: "corrupt" };
  }
  if (!dimensionsFit(width, height)) {
    return { ok: false, reason: "dimensions" };
  }
  return { ok: true, bytes: Buffer.concat(kept), width, height };
}

/**
 * Index of the next marker after entropy-coded scan data.
 * Stuffed `FF 00` bytes and restart markers stay inside the scan.
 * Returns -1 when the scan never reaches another marker.
 */
function jpegEntropyEnd(input: Buffer, scan: number): number {
  while (scan + 1 < input.length) {
    if (input[scan] !== 0xff) {
      scan += 1;
      continue;
    }
    const next = input[scan + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      scan += 2;
      continue;
    }
    if (next === 0xff) {
      scan += 1;
      continue;
    }
    return scan;
  }
  return -1;
}

function parseJpeg(
  input: Buffer,
): { ok: true; bytes: Buffer; width: number; height: number } | { ok: false; reason: "corrupt" } {
  const pieces: Buffer[] = [];
  let index = 0;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  let sawScan = false;

  while (index < input.length) {
    if (input[index] !== 0xff) {
      return { ok: false, reason: "corrupt" };
    }
    index += 1;
    while (index < input.length && input[index] === 0xff) {
      index += 1;
    }
    if (index >= input.length) {
      return { ok: false, reason: "corrupt" };
    }
    const marker = input[index];
    index += 1;

    if (marker === 0xd8 && pieces.length === 0) {
      pieces.push(Buffer.from([0xff, 0xd8]));
      continue;
    }
    if (marker === 0xd9) {
      if (!sawFrame || !sawScan) {
        return { ok: false, reason: "corrupt" };
      }
      pieces.push(Buffer.from([0xff, 0xd9]));
      return { ok: true, bytes: Buffer.concat(pieces), width, height };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pieces.push(Buffer.from([0xff, marker]));
      continue;
    }
    if (index + 2 > input.length) {
      return { ok: false, reason: "corrupt" };
    }
    const segmentLength = input.readUInt16BE(index);
    if (segmentLength < 2 || index + segmentLength > input.length) {
      return { ok: false, reason: "corrupt" };
    }

    if (marker === 0xda) {
      // A progressive photo stores several scans. The next marker is often another
      // Huffman table, not the end of the image. Stop the entropy read at that marker
      // and let the outer loop keep going until the real end-of-image marker.
      const headerEnd = index + segmentLength;
      const scanEnd = jpegEntropyEnd(input, headerEnd);
      if (scanEnd < 0) {
        return { ok: false, reason: "corrupt" };
      }
      pieces.push(input.subarray(index - 2, headerEnd), input.subarray(headerEnd, scanEnd));
      sawScan = true;
      index = scanEnd;
      continue;
    }

    const segment = input.subarray(index - 2, index + segmentLength);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (segmentLength < 7) {
        return { ok: false, reason: "corrupt" };
      }
      height = input.readUInt16BE(index + 3);
      width = input.readUInt16BE(index + 5);
      sawFrame = true;
    }
    // APP1 is EXIF. APP13 is IPTC. Neither is required to display the photo.
    if (marker !== 0xe1 && marker !== 0xed) {
      pieces.push(segment);
    }
    index += segmentLength;
  }

  return { ok: false, reason: "corrupt" };
}

function parseWebp(
  input: Buffer,
): { ok: true; bytes: Buffer; width: number; height: number } | { ok: false; reason: "corrupt" } {
  const declaredEnd = input.readUInt32LE(4) + 8;
  if (declaredEnd < 12 || declaredEnd > input.length) {
    return { ok: false, reason: "corrupt" };
  }
  let cursor = 12;
  const kept: Buffer[] = [];
  let sawBitmap = false;
  while (cursor + 8 <= declaredEnd) {
    const tag = input.toString("ascii", cursor, cursor + 4);
    if (!/^[A-Za-z0-9 ]{4}$/.test(tag)) {
      return { ok: false, reason: "corrupt" };
    }
    const size = input.readUInt32LE(cursor + 4);
    const payloadEnd = cursor + 8 + size;
    const paddedEnd = payloadEnd + (size % 2 === 1 ? 1 : 0);
    if (size > input.length || paddedEnd > declaredEnd) {
      return { ok: false, reason: "corrupt" };
    }
    if (tag === "VP8 " || tag === "VP8L" || tag === "VP8X") {
      sawBitmap = true;
    }
    if (!WEBP_METADATA.has(tag)) {
      kept.push(input.subarray(cursor, paddedEnd));
    }
    cursor = paddedEnd;
  }
  if (!sawBitmap || cursor !== declaredEnd) {
    return { ok: false, reason: "corrupt" };
  }
  const body = Buffer.concat(kept);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return { ok: true, bytes: Buffer.concat([header, body]), width: 0, height: 0 };
}
