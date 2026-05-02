/** Default scoped target for Probe hackathon — anything that parses as “scan this thing”. */

let canonicalTargetHost = 'localhost:8787';

export function probeCurrentTarget(): string {
  return canonicalTargetHost;
}

export function probeSetCanonicalTarget(raw: string): void {
  const t = raw.replace(/^[`'"]+/,'').replace(/[`'";]+$/,'').trim();
  if (!t) return;
  try {
    if (/^https?:\/\//i.test(t)) {
      const u = new URL(t);
      canonicalTargetHost = u.host + (u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/,'') : '');
    } else canonicalTargetHost = t.replace(/^\/*/, '').replace(/\/+$/, '');
  } catch {
    canonicalTargetHost = t;
  }
}

export function clearProbeCanonicalTarget(): void {
  canonicalTargetHost = 'localhost:8787';
}
