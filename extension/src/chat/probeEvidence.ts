/**
 * Session-local evidence retained for scripted demo artifacts (curl-headers capture).
 */

let lastCurlHeadersBody = "";

export function setCurlHeadersEvidence(markdownEscapedBody: string): void {
  lastCurlHeadersBody = markdownEscapedBody;
}

/** Raw output text suitable for stuffing into markdown `pre` blocks. */
export function getCurlHeadersEvidence(): string {
  return lastCurlHeadersBody.trim() || '(No curl-headers capture yet — run curl-headers against the target URL first.)';
}

export function appendCurlHeadersChunk(chunk: string): void {
  lastCurlHeadersBody += chunk;
}

export function clearProbeEvidence(): void {
  lastCurlHeadersBody = '';
}
