import "server-only";
import { createHash } from "node:crypto";
import Redis from "ioredis";
import { rateLimit, clearRateLimit, type RateLimitOptions, type RateLimitResult } from "./rate-limit";

const script = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

let client: Redis | undefined;
let connecting: Promise<Redis> | undefined;

// Chamadas simultâneas (ex.: login limita por IP e por e-mail em paralelo)
// precisam esperar a MESMA conexão: sem fila offline, um comando enviado
// enquanto o status é "connecting" falha e derrubaria o cliente de todos.
function redis(): Promise<Redis> {
  if (client?.status === "ready") return Promise.resolve(client);
  if (!connecting) {
    const c = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    c.on("error", () => {});
    connecting = c.connect().then(
      () => {
        client = c;
        connecting = undefined;
        return c;
      },
      (err) => {
        c.disconnect();
        connecting = undefined;
        throw err;
      },
    );
  }
  return connecting;
}

function resetClient(failed: Redis | undefined) {
  // Só descarta o cliente que falhou, não um que outra chamada acabou de abrir.
  if (failed && client === failed) {
    client.disconnect();
    client = undefined;
  }
}

// Hash impede que e-mail/IP apareçam em nomes de chaves do Redis.
function redisKey(key: string) {
  return `novacrm:rate:${createHash("sha256").update(key).digest("hex")}`;
}

export async function sharedRateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  if (process.env.NODE_ENV !== "production" && !process.env.REDIS_URL) return rateLimit(key, opts);
  let connection: Redis | undefined;
  try {
    connection = await redis();
    const result = await connection.eval(script, 1, redisKey(key), String(opts.windowMs));
    if (!Array.isArray(result)) throw new Error("Resposta inválida do limitador");
    const count = Number(result[0]);
    const ttl = Number(result[1]);
    return {
      ok: count <= opts.limit,
      remaining: Math.max(0, opts.limit - count),
      retryAfterSec: count <= opts.limit ? 0 : Math.max(1, Math.ceil(ttl / 1000)),
    };
  } catch {
    resetClient(connection);
    // Sem o limitador compartilhado, autenticação e APIs públicas não aceitam
    // tráfego irrestrito. O operador vê indisponibilidade temporária.
    return { ok: false, remaining: 0, retryAfterSec: 30 };
  }
}

export async function clearSharedRateLimit(key: string) {
  if (process.env.NODE_ENV !== "production" && !process.env.REDIS_URL) return clearRateLimit(key);
  let connection: Redis | undefined;
  try {
    connection = await redis();
    await connection.del(redisKey(key));
  } catch {
    resetClient(connection);
    // O contador expira sozinho; não impedir um login já autenticado.
  }
}
