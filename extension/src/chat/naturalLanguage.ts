import type { ToolDescriptor } from "../api/types.js";

const GENERIC_STOP = new Set(
  `
  the a an for and or to with please this that can you we need hi hello hey
  my our some any out use using run scan scans scanning found find search
  lets let me my how do does what when where who which about into from
`.split(/\s+/g),
);

/**
 * Pull likely hostnames / IPs from noisy natural language so we can propose
 * a `run` without expecting exact command syntax.
 */
export function extractNetworkTargets(raw: string): string[] {
  const seen = new Set<string>();
  const add = (v: string) => {
    const t = v.replace(/^<|>$/g, "").replace(/[)}\],.?]+$/g, "");
    const x = t.toLowerCase();
    if (
      x &&
      x.length <= 253 &&
      !GENERIC_STOP.has(x) &&
      !x.startsWith("http://") &&
      !x.startsWith("https://")
    ) {
      seen.add(t);
    }
  };

  const ipMatches = raw.matchAll(
    /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
  );
  for (const m of ipMatches) add(m[0]);

  // Simple hostnames like scanme.nmap.org (need at least one dot).
  const hostMatches = raw.matchAll(
    /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}\b/g,
  );
  for (const m of hostMatches) add(m[0]);

  return [...seen];
}

function pickTool(tools: ToolDescriptor[], id: string): ToolDescriptor | undefined {
  return tools.find((t) => t.id === id);
}

/**
 * Map loose keywords in the user message to a backend tool (if registered).
 */
export function inferToolFromMessage(
  message: string,
  tools: ToolDescriptor[],
): ToolDescriptor | undefined {
  const lower = message.toLowerCase();
  if (tools.length === 0) return undefined;

  // Explicit id mention wins.
  for (const t of tools) {
    if (lower.includes(t.id.toLowerCase())) return t;
  }

  if (/\bnmap-full\b|\b(deep|full|comprehensive)\b.*\b(nmap|scan)\b|\b(nmap|scan)\b.*\b(deep|full)\b/.test(lower)) {
    return pickTool(tools, "nmap-full") ?? pickTool(tools, "nmap-quick");
  }
  if (
    /\bnmap\b|\bping sweep\b|\bport\s*-?scan\b|\bopen\s+ports?\b|\bscan\s+(the\s+)?(wifi|network|host|subnet|target)\b|\b(can|could)\s+we\s+nmap\b|\bnmap\s+the\b/.test(
      lower,
    )
  ) {
    return pickTool(tools, "nmap-quick") ?? pickTool(tools, "nmap-full");
  }
  if (
    /\bnikto\b|\bvulnerabilit(y|ies)\b|\bweb\s*vuln\b|\bdirb\b|\bweb\s*(app\s*)?(scan|test)\b/.test(
      lower,
    )
  ) {
    return pickTool(tools, "nikto") ?? pickTool(tools, "httpx-probe");
  }
  if (/\bhttpx\b|\bhttp\s+(probe|check|finger)/.test(lower)) {
    return pickTool(tools, "httpx-probe");
  }
  if (/\bwhat\s*web\b|\bfingerprint\b.*\bweb\b|\btech\s*stacks?\b/.test(lower)) {
    return pickTool(tools, "whatweb");
  }
  if (/\b(cert|certificate|tls|ssl)\b/.test(lower) && /\b(check|grab|inspect|show)\b/.test(lower)) {
    return pickTool(tools, "tls-cert") ?? pickTool(tools, "curl-headers");
  }
  if (/\b(whois)\b|\bdomain\s+registration\b/.test(lower)) {
    return pickTool(tools, "whois-lookup");
  }
  if (/\bdig\b|\bdns\b.*\brecon\b|\bdns\b.*\blookup\b/.test(lower)) {
    return pickTool(tools, "dig-recon");
  }
  if (/\bcurl\b|\bheaders\b|\bhttp\s+headers?\b/.test(lower)) {
    return pickTool(tools, "curl-headers");
  }
  if (/\bport\s*probe\b|\btcp\s*connect\b/.test(lower)) {
    return pickTool(tools, "port-probe");
  }

  return undefined;
}

export type ConversationalTurn =
  | { kind: "greeting" }
  | { kind: "gratitude" }
  | {
      kind: "wifi_ambiguous";
    }
  | {
      kind: "suggest_scan";
      tool: ToolDescriptor;
      targets: string[];
    }
  | {
      kind: "need_target";
      tool: ToolDescriptor;
    };

/**
 * Lightweight intent recovery for conversational input (no LLM). Cursor-style
 * behaviour needs a model upstream; this is the next-best layer.
 */
export function classifyConversational(
  raw: string,
  tools: ToolDescriptor[],
): ConversationalTurn | undefined {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return undefined;

  if (/^(thanks|thank\s+you|thx)\b/i.test(trimmed)) {
    return { kind: "gratitude" };
  }

  if (
    /^(hi|hello|hey|yo|good\s+(morning|afternoon|evening))[!\s,.]*$/i.test(trimmed) ||
    (/^(hi|hello|hey)\b/i.test(trimmed) && trimmed.length <= 56)
  ) {
    return { kind: "greeting" };
  }

  const targets = extractNetworkTargets(trimmed);
  const tool = inferToolFromMessage(trimmed, tools);

  if (tool && targets.length >= 1) {
    return { kind: "suggest_scan", tool, targets };
  }

  if (
    tool &&
    /\b(scan|probe|check|nmap|port|ping|vulnerabilit|enumerate)\b/i.test(
      lower,
    )
  ) {
    return { kind: "need_target", tool };
  }

  if (/\b(wifi|wi-?fi|wireless|wps)\b/i.test(lower)) {
    return { kind: "wifi_ambiguous" };
  }

  return undefined;
}
