import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0, 168].includes(b)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && [18, 19, 51].includes(b)) && !(a === 203 && b === 0);
  }
  // Global-unicast IPv6 only; also excludes mapped IPv4 and local addresses.
  return family === 6 && /^[23]/i.test(address) && !address.toLowerCase().startsWith("2001:db8:");
}

export async function postOutboundWebhook(rawUrl: string, payload: unknown): Promise<number> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Use uma URL HTTPS pública na porta padrão, sem credenciais na URL.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error("Webhooks não podem acessar endereços locais, privados ou reservados.");
  const body = JSON.stringify(payload);
  if (body.length > 512_000) throw new Error("Payload de webhook muito grande.");
  // Pin the validated IP; DNS is not resolved again when opening the socket.
  return new Promise((resolve, reject) => {
    const req = request({ hostname: addresses[0].address, family: addresses[0].family, servername: hostname, port: 443, method: "POST", path: url.pathname + url.search, headers: { Host: hostname, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, signal: AbortSignal.timeout(10_000) }, (response) => { resolve(response.statusCode ?? 502); response.destroy(); });
    req.on("error", reject);
    req.end(body);
  });
}
