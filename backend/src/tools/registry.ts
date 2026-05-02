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
];

export function findTool(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}
