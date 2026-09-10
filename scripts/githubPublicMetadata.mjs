/**
 * Pure endpoint redaction for README/About text. Callers explicitly supply known HTTP(S)
 * backend origins; this helper does not discover targets or change repository source/config.
 */
export const BACKEND_ENDPOINT_REDACTION = "[backend endpoint omitted]";

export function redactKnownBackendUrls(text, knownOrigins) {
  if (typeof text !== "string" || !Array.isArray(knownOrigins)) {
    throw new TypeError("Expected metadata text and an explicit list of backend origins.");
  }
  const origins = new Set(knownOrigins.map((value) => {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error("A backend origin is not a valid HTTP(S) URL."); }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("Backend origins must contain only HTTP(S) scheme, hostname, and optional port.");
    }
    return parsed.origin;
  }));
  if (origins.size === 0) return text;
  const known = (url) => {
    try { return origins.has(new URL(url).origin); } catch { return false; }
  };

  // Remove only links to an approved backend, preserving their visible label/title and all
  // unrelated links. Rendering a literal placeholder as a Markdown link target would break it.
  const links = text.replace(/!?\[([^\]\r\n]*)\]\((https?:\/\/[^\s)]+)(?:[ \t]+"([^"\r\n]*)")?\)/gi,
    (whole, label, url, title) => known(url)
      ? `${label}${title ? ` (${title})` : ""} ${BACKEND_ENDPOINT_REDACTION}` : whole);
  const autolinks = links.replace(/<(https?:\/\/[^<>\s]+)>/gi,
    (whole, url) => known(url) ? BACKEND_ENDPOINT_REDACTION : whole);
  return autolinks.replace(/\bhttps?:\/\/[^\s<>"'`]+/gi, (token) => {
    // Sentence/Markdown punctuation is not part of the endpoint disclosure.
    const suffix = /[.,;:!?)}\]]+$/.exec(token)?.[0] ?? "";
    const url = suffix ? token.slice(0, -suffix.length) : token;
    if (suffix.startsWith("]") && known(`${url}]`)) return `${BACKEND_ENDPOINT_REDACTION}${suffix.slice(1)}`;
    return known(url) ? `${BACKEND_ENDPOINT_REDACTION}${suffix}` : token;
  });
}
