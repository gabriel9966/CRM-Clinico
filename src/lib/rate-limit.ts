// Limite de requisições por janela fixa, em memória do processo. Serve para
// frear força bruta no login e flood nos webhooks/API. Limitação conhecida: o
// contador é por instância — com mais de uma réplica do app o limite efetivo
// multiplica; nesse caso troque o Map por Redis (o app já usa ioredis).

type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();
const PRUNE_ABOVE = 5000;

export type RateLimitOptions = { limit: number; windowMs: number };
export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSec: number };

function prune(now: number) {
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

/** Conta uma tentativa em `key` e diz se ainda está dentro do limite. */
export function rateLimit(key: string, opts: RateLimitOptions, now: number = Date.now()): RateLimitResult {
  if (buckets.size > PRUNE_ABOVE) prune(now);

  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(key, entry);
  }
  entry.count += 1;

  const ok = entry.count <= opts.limit;
  return {
    ok,
    remaining: Math.max(0, opts.limit - entry.count),
    retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

/** Zera um contador (ex.: depois de um login bem-sucedido). */
export function clearRateLimit(key: string) {
  buckets.delete(key);
}

export function resetAllRateLimits() {
  buckets.clear();
}

// IP do cliente atrás do nginx. O nginx define X-Real-IP com o endereço que
// ele mesmo viu ($remote_addr), que o cliente não consegue forjar; o
// X-Forwarded-For pode vir com valores inventados no começo, então só o
// último item é confiável.
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}
