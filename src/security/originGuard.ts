const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Allows non-browser clients, this app's own origin, and loopback dev servers.
 * A browser on another site sends an `Origin` that fails this check.
 *
 * @param originHeader - The raw Origin header, or undefined when the client did not send one.
 * @param publicBaseUrl - The configured public URL of this server.
 * @returns True when the request may call the API.
 */
export function isAllowedOrigin(originHeader: string | undefined, publicBaseUrl: string): boolean {
  if (originHeader === undefined || originHeader === "") {
    return true;
  }
  if (originHeader === "null") {
    return false;
  }

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    return false;
  }
  if (LOCAL_HOSTS.has(origin.hostname)) {
    return true;
  }

  try {
    return origin.host === new URL(publicBaseUrl).host;
  } catch {
    return false;
  }
}
