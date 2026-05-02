import { extractNetworkTargets } from "./naturalLanguage.js";
import { probeCurrentTarget, probeSetCanonicalTarget } from "./probeState.js";

/** Normalize for scripted exact-match keys and fuzzy keyword passes. */

export function normalizeProbeInput(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Hardcoded NLP → executable probe intents (no LLM). */

export type Command =
  | { tag: "message"; markdown: string }
  | { tag: "connect_urls"; url: string; apiKey?: string }
  | { tag: "create_session"; sessionName?: string }
  | { tag: "tools" }
  | { tag: "run"; toolId: string; target: string; args?: Record<string, string> }
  | { tag: "styled_report" };

export type DemoResponse =
  | {
      variant: "bubbles_then_connect";
      ux: readonly string[];
      backendUrl: string;
      backendKey: string;
    }
  | {
      variant: "bubbles_then_create_session";
      uxBefore: readonly string[];
      name: string;
    }
  | { variant: "native_run"; toolId: string; target: string }
  | { variant: "styled_report_placeholder" };

/** Judge demo: exact normalized lines only (see handleDemoScript in router). */
export const DEMO_SCRIPT: ReadonlyArray<{
  readonly trigger: string;
  readonly response: DemoResponse;
}> = [
  {
    trigger: "connect http://localhost:8787 dev-key",
    response: {
      variant: "bubbles_then_connect",
      ux: ["✓ Connected to http://localhost:8787", "Scope validated ✓"],
      backendUrl: "http://localhost:8787",
      backendKey: "dev-key",
    },
  },
  {
    trigger: "create session acme-engagement",
    response: {
      variant: "bubbles_then_create_session",
      uxBefore: [],
      name: "acme-engagement",
    },
  },
  { trigger: "report", response: { variant: "styled_report_placeholder" } },
];

const DEMO_LUT: ReadonlyMap<string, DemoResponse> = new Map(
  DEMO_SCRIPT.map((p) => [normalizeProbeInput(p.trigger), p.response]),
);

export function probeDemoLookup(normalized: string): DemoResponse | null {
  return DEMO_LUT.get(normalized) ?? null;
}

function sniffUrl(raw: string): string | undefined {
  const u = /\b(https?:\/\/[^\s]+)\b/i.exec(raw)?.[1];
  if (u) return u;
  const hp = /\b(?:localhost|[\w.-]+\.[a-z]{2,}):\d{2,5}\b/i.exec(raw)?.[0];
  if (hp) return hp.includes("://") ? hp : `http://${hp}`;
  return undefined;
}

function pickTarget(raw: string): string {
  const extracted = extractNetworkTargets(raw);
  if (extracted.length) return extracted[0];
  const s = sniffUrl(raw);
  if (s) return s;
  return probeCurrentTarget();
}

function httpize(hostOrUrl: string): string {
  if (/^https?:\/\//i.test(hostOrUrl)) return hostOrUrl;
  return `http://${hostOrUrl}`;
}

function wantsWebProbe(input: string): boolean {
  if (/\bnmap\b/i.test(input)) return false;
  return (
    /\bweb\b/i.test(input) ||
    /\bwebsite\b/i.test(input) ||
    /\bwebapp\b/i.test(input) ||
    /\bhttps?\b/i.test(input) ||
    /\bapplication\b/i.test(input) ||
    /\bapp\b/i.test(input)
  );
}

function wantsWhatweb(input: string): boolean {
  return (
    /\b(technologies?|tech\s*stack|stack|whatweb|framework|cms)\b/i.test(
      input,
    ) ||
    /\bwhat\s+technologies\b/i.test(input) ||
    (/\brunning\b/i.test(input) &&
      /\b(technologies?|technology|tech|stack)\b/i.test(input))
  );
}

/** Keyword-only resolver (always returns a concrete command or guidance message). */

export function resolveIntent(input: string): Command {
  const key = normalizeProbeInput(input);

  if (/\b(report|findings|summary)\b/i.test(input)) {
    return { tag: "styled_report" };
  }

  if (
    /\b(?:help|\?|commands|tool\s*catalog|cheat\s*sheet|capabilities|what\s+can\s+you)\b/i.test(
      input,
    ) ||
    /\btools\b/i.test(input)
  ) {
    return { tag: "tools" };
  }

  const connectVerb =
    /\b(?:connect(?:\s+to)?|set\s+target|target\s+is|attacking|authenticate|engage)\b/i.test(
      input,
    );

  const urlHit = sniffUrl(input);
  if (connectVerb && urlHit) {
    const tail = input
      .slice(input.toLowerCase().indexOf(urlHit.toLowerCase()) + urlHit.length)
      .trim();
    const parts = tail.split(/\s+/).filter(Boolean);
    const skip = new Set(["with", "key", "using", "token", "bearer", "and"]);
    const tokenish = parts.find((p) => p.length >= 3 && !skip.has(p.toLowerCase()));
    let apiKey: string | undefined;
    if (
      tokenish &&
      !/^https?:\/\//i.test(tokenish) &&
      !/^[a-z]+:\d+$/i.test(tokenish)
    ) {
      apiKey = tokenish.replace(/^["'`]+|["'`]+$/g, "");
    }
    return { tag: "connect_urls", url: urlHit, apiKey };
  }

  const targetIs =
    /(?:target\s+is|scope\s+is|locking\s+|locked\s+(?:onto|to)|host\s+is)\s+([^\s]+)/i.exec(
      input,
    );
  if (targetIs) {
    const chunk = targetIs[1].replace(/[,;.]+$/g, "");
    probeSetCanonicalTarget(chunk);
    return {
      tag: "message",
      markdown: `### Target vector updated\nPersistent scope **\`${chunk}\`** — subsequent recon verbs latch here.`,
    };
  }

  if (
    /\b(?:start|open|begin|launch|kick\s*off|new)\s+(?:a\s+|the\s+|my\s+|our\s+)?(?:session|engagement|workspace)\b/i.test(
      input,
    ) ||
    /\b(?:session|engagement)\s+(?:start|open|begin|create)\b/i.test(input)
  ) {
    const byName =
      /(?:called|named|for)\s+["']?([\w.-]{2,})["']?/i.exec(input)?.[1] ??
      /(?:session|engagement)\s+["']?([\w.-]{2,})["']?/i.exec(input)?.[1];
    return { tag: "create_session", sessionName: byName };
  }

  if (
    /\b(?:full|deep|thorough|comprehensive)\s+(?:port\s*)?scan\b/i.test(input) ||
    /\ball\s+ports\b/i.test(key)
  ) {
    return { tag: "run", toolId: "nmap-full", target: pickTarget(input) };
  }

  if (
    /\b(?:scan|scans|scanning|ports?|port\s*scan|recon(?:naissance)?)\b/i.test(
      input,
    )
  ) {
    return { tag: "run", toolId: "nmap-quick", target: "127.0.0.1" };
  }

  if (wantsWhatweb(input)) {
    return {
      tag: "run",
      toolId: "whatweb",
      target: "http://localhost:8787",
    };
  }

  if (
    /\bnikto\b/i.test(input) ||
    /\bweb\s+vulns?\b/i.test(input) ||
    /\bweb\s+vulnerabilit/i.test(input) ||
    /\bcve\b/i.test(key)
  ) {
    return { tag: "run", toolId: "nikto", target: httpize(pickTarget(input)) };
  }

  if (/\b(?:headers?|server\s+header|response)\b/i.test(input)) {
    return { tag: "run", toolId: "curl-headers", target: httpize(pickTarget(input)) };
  }

  if (wantsWebProbe(input)) {
    return {
      tag: "run",
      toolId: "httpx-probe",
      target: "http://localhost:8787",
    };
  }

  return {
    tag: "message",
    markdown:
      "Try: 'scan for open ports' or 'check the web app'",
  };
}
