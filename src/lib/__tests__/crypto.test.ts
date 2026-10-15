import { describe, it, expect } from "vitest";
import { encryptJson, decryptJson } from "../crypto";

describe("crypto (AES-256-GCM)", () => {
  it("round-trips objects correctly", () => {
    const original = { apiKey: "secret-value-123", nested: { n: 1 } };
    const encrypted = encryptJson(original);
    expect(encrypted).not.toContain("secret-value-123");
    expect(decryptJson(encrypted)).toEqual(original);
  });

  it("round-trips plain strings", () => {
    const encrypted = encryptJson("mcp_abc123");
    expect(decryptJson<string>(encrypted)).toBe("mcp_abc123");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptJson("same-value");
    const b = encryptJson("same-value");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with a tampered payload", () => {
    const encrypted = encryptJson("secret");
    const [iv, tag, data] = encrypted.split(":");
    const tampered = [iv, tag, data.slice(0, -4) + "aaaa"].join(":");
    expect(() => decryptJson(tampered)).toThrow();
  });

  it("returns an empty object for a malformed payload instead of crashing", () => {
    expect(decryptJson("not-a-valid-payload")).toEqual({});
  });
});
