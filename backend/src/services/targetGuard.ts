import { isIP } from "node:net";
import type { AppConfig } from "../config.js";

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export class TargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetError";
  }
}

/**
 * Returns the validated, lowercased target. Throws TargetError if the input is
 * malformed, points at private/loopback space when public-only mode is on, or
 * is not in the configured allowlist.
 */
export function validateTarget(raw: string, config: AppConfig): string {
  const target = raw.trim();
  if (!target) throw new TargetError("Target is required");
  if (target.length > 253) throw new TargetError("Target is too long");
  if (/[\s;|&`$<>]/.test(target)) {
    throw new TargetError("Target contains forbidden characters");
  }

  const ipKind = isIP(target);
  const looksLikeIp = ipKind === 4 || ipKind === 6;
  const looksLikeHost = HOSTNAME_RE.test(target);
  if (!looksLikeIp && !looksLikeHost) {
    throw new TargetError("Target must be a hostname or IP address");
  }

  if (config.requirePublicTargets && looksLikeIp && isPrivateIp(target)) {
    throw new TargetError("Private/loopback targets are disabled on this server");
  }

  if (config.targetAllowlist.length > 0) {
    const allowed = config.targetAllowlist.some((entry) =>
      matchAllowlistEntry(target, entry),
    );
    if (!allowed) {
      throw new TargetError("Target is not in the server allowlist");
    }
  }

  return target.toLowerCase();
}

export function isPrivateIp(ip: string): boolean {
  if (ip === "0.0.0.0" || ip === "::" || ip === "::1") return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd")) return true;
  if (ip.toLowerCase().startsWith("fe80:")) return true;
  return false;
}

function matchAllowlistEntry(target: string, entry: string): boolean {
  if (entry === target) return true;
  if (entry.startsWith("*.") && target.endsWith(entry.slice(1))) return true;
  return false;
}
