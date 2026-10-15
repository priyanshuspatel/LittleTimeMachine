/**
 * Turns an absolute media URL from this API into a path the page can request
 * on its own origin. Blob and data URLs are returned unchanged because they
 * are already local to the document.
 *
 * @param url - Absolute `http` URL, a blob URL, or an already-relative path.
 * @returns A same-origin path, or the original value when it cannot be parsed.
 */
export function sameOriginMedia(url: string): string {
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    return url;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
