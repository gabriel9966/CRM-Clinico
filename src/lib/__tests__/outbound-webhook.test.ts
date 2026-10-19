import { describe, it, expect } from "vitest";
import { isPublicAddress, postOutboundWebhook } from "../outbound-webhook";
describe("webhook de saída", () => {
  it("bloqueia redes internas, metadata e IPv4 mapeado em IPv6", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.100.100.200", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "0.0.0.0"]) expect(isPublicAddress(ip), ip).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("recusa HTTP e credenciais antes de abrir conexão", async () => {
    await expect(postOutboundWebhook("http://127.0.0.1", {})).rejects.toThrow(/HTTPS/);
    await expect(postOutboundWebhook("https://user:pass@example.com", {})).rejects.toThrow(/credenciais/);
  });
});
