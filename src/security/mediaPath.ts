const PUBLIC_MEDIA_PATH =
  /^(photos\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)|tts\/[0-9a-f]{64}\.mp3)$/i;

/**
 * Decides whether a `/media` request path is one this server is willing to publish.
 * Generated photo ids and speech hashes match. Caller-supplied names, extensions, and
 * parent-directory segments do not.
 *
 * @param requestPath - The path Express saw, including a leading slash.
 * @returns True only for a photo or speech file created by this server.
 */
export function isPublicMediaPath(requestPath: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return false;
  }
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("\0")) {
    return false;
  }
  const relative = decoded.replace(/^\/+/, "").replace(/^media\//, "");
  return PUBLIC_MEDIA_PATH.test(relative);
}
