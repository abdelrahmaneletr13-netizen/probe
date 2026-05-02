import type { ToolDef } from "../types.js";

export const TOOLS: ToolDef[] = [
  {
    id: "nmap-quick",
    label: "Nmap (quick scan)",
    description: "Top 100 TCP ports, service detection, no scripts.",
    binary: "nmap",
    category: "scan",
    argsSchema: [
      {
        name: "ports",
        label: "Top ports",
        type: "number",
        default: 100,
        help: "Scan the N most common ports.",
      },
    ],
    buildCommand: (target, args) => [
      "-Pn",
      "--top-ports",
      String(args.ports ?? 100),
      "-sV",
      "-T4",
      target,
    ],
  },
  {
    id: "nmap-full",
    label: "Nmap (full TCP)",
    description: "Full TCP port sweep, slower, with version detection.",
    binary: "nmap",
    category: "scan",
    argsSchema: [],
    buildCommand: (target) => ["-Pn", "-p-", "-sV", "-T4", target],
  },
  {
    id: "httpx-probe",
    label: "httpx (HTTP probe)",
    description: "Probe HTTP/HTTPS, follow redirects, capture title and tech.",
    binary: "httpx",
    category: "web",
    argsSchema: [],
    buildCommand: (target) => [
      "-u",
      target,
      "-status-code",
      "-title",
      "-tech-detect",
      "-no-color",
      "-silent",
    ],
  },
  {
    id: "whatweb",
    label: "WhatWeb",
    description: "Identify web technologies in use on a target URL.",
    binary: "whatweb",
    category: "web",
    argsSchema: [
      {
        name: "aggression",
        label: "Aggression level",
        type: "enum",
        options: ["1", "3", "4"],
        default: "1",
        help: "1 = passive, 3 = aggressive, 4 = heavy.",
      },
    ],
    buildCommand: (target, args) => [
      `-a${args.aggression ?? "1"}`,
      "--no-errors",
      "--color=never",
      target,
    ],
  },
  {
    id: "nikto",
    label: "Nikto",
    description: "Classic web server vulnerability scanner.",
    binary: "nikto",
    category: "web",
    argsSchema: [],
    buildCommand: (target) => ["-host", target, "-ask", "no", "-nointeractive"],
  },

  // ── Built-in tools (work on any macOS / Linux without extra installs) ──
  {
    id: "dig-recon",
    label: "DNS recon (dig)",
    description: "Resolve A, AAAA, MX, NS, TXT, and SOA records for a domain.",
    binary: "sh",
    category: "recon",
    argsSchema: [],
    buildCommand: (target) => [
      "-c",
      `for type in A AAAA MX NS TXT SOA CNAME; do echo ""; echo "=== $type ==="; dig +short +tries=1 +time=3 "${target}" $type; done`,
    ],
  },
  {
    id: "curl-headers",
    label: "HTTP headers (curl)",
    description: "Fetch HTTP response headers and follow redirects to fingerprint the server. Tries HTTPS first, falls back to HTTP.",
    binary: "sh",
    category: "web",
    argsSchema: [
      {
        name: "scheme",
        label: "Scheme",
        type: "enum",
        options: ["auto", "https", "http"],
        default: "auto",
        help: "auto = try https then fall back to http on failure.",
      },
    ],
    buildCommand: (target, args) => {
      const scheme = (args.scheme as string) || "auto";
      if (scheme === "auto") {
        return [
          "-c",
          `(curl -fsSL --fail-early -D - -o /dev/null --max-time 10 -A "pentest-ide/0.1" "https://${target}/" 2>/dev/null && exit 0) || (echo "[https failed, falling back to http]" && curl -sSL -D - -o /dev/null --max-time 10 -A "pentest-ide/0.1" "http://${target}/" 2>&1 | head -40)`,
        ];
      }
      return [
        "-c",
        `curl -sSL -D - -o /dev/null --max-time 15 -A "pentest-ide/0.1" "${scheme}://${target}/" 2>&1 | head -40`,
      ];
    },
  },
  {
    id: "tls-cert",
    label: "TLS certificate inspect (openssl)",
    description: "Inspect the TLS certificate: subject, issuer, SANs, expiry.",
    binary: "sh",
    category: "infra",
    argsSchema: [
      {
        name: "port",
        label: "Port",
        type: "number",
        default: 443,
      },
    ],
    buildCommand: (target, args) => {
      const port = Number(args.port ?? 443);
      // Use -text and grep instead of -ext (works on both OpenSSL and macOS LibreSSL).
      return [
        "-c",
        `(echo | openssl s_client -servername ${target} -connect ${target}:${port} -showcerts 2>/dev/null | openssl x509 -noout -subject -issuer -dates -text 2>/dev/null | grep -E "Subject:|Issuer:|Not Before|Not After|DNS:" | sed 's/^[[:space:]]*//' | head -20) || echo "TLS handshake failed (port may not be TLS)"`,
      ];
    },
  },
  {
    id: "whois-lookup",
    label: "WHOIS lookup",
    description: "Domain registration info: registrar, dates, name servers.",
    binary: "sh",
    category: "recon",
    argsSchema: [],
    buildCommand: (target) => [
      "-c",
      `whois "${target}" 2>&1 | grep -iE "registrar|registered|created|expire|updated|name server|status|organization" | head -25`,
    ],
  },
  {
    id: "port-probe",
    label: "Port probe (built-in)",
    description: "Quick TCP probe of common ports using bash /dev/tcp.",
    binary: "bash",
    category: "scan",
    argsSchema: [
      {
        name: "ports",
        label: "Ports to probe",
        type: "string",
        default: "21,22,25,53,80,110,143,443,465,587,993,995,3306,3389,5432,6379,8080,8443",
        help: "Comma-separated TCP ports.",
      },
    ],
    buildCommand: (target, args) => {
      const ports = String(args.ports ?? "80,443");
      return [
        "-c",
        `for p in ${ports.replace(/,/g, " ")}; do (echo > /dev/tcp/${target}/$p) >/dev/null 2>&1 && echo "  OPEN  ${target}:$p" || echo "closed ${target}:$p"; done`,
      ];
    },
  },
];

export function findTool(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}
