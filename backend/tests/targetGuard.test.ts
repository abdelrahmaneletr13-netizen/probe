import { describe, expect, it } from "vitest";
import { isPrivateIp, validateTarget, TargetError } from "../src/services/targetGuard.js";
import { makeConfig } from "./helpers.js";

describe("targetGuard", () => {
  it("accepts hostnames and IPv4", () => {
    expect(validateTarget("example.com", makeConfig())).toBe("example.com");
    expect(validateTarget("8.8.8.8", makeConfig())).toBe("8.8.8.8");
  });

  it("rejects shell metacharacters", () => {
    expect(() => validateTarget("example.com;rm -rf /", makeConfig())).toThrow(TargetError);
  });

  it("rejects empty input", () => {
    expect(() => validateTarget("   ", makeConfig())).toThrow(TargetError);
  });

  it("blocks private IPs when public-only mode is on", () => {
    const cfg = makeConfig({ requirePublicTargets: true });
    expect(() => validateTarget("10.0.0.1", cfg)).toThrow(TargetError);
    expect(() => validateTarget("127.0.0.1", cfg)).toThrow(TargetError);
  });

  it("honors allowlist", () => {
    const cfg = makeConfig({ targetAllowlist: ["*.example.com", "8.8.8.8"] });
    expect(validateTarget("foo.example.com", cfg)).toBe("foo.example.com");
    expect(() => validateTarget("evil.com", cfg)).toThrow(TargetError);
  });

  it("isPrivateIp covers common ranges", () => {
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
});
