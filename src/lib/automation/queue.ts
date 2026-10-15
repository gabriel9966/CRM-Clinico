import "server-only";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

// Fila de verdade (Redis + BullMQ) pros nós de "Espera" das automações.
// Se o Redis não estiver disponível (ex: ambiente de desenvolvimento sem
// Redis instalado), o sistema cai automaticamente para um modo de
// segurança: os agendamentos ficam só no banco (tabela AutomationSchedule)
// e um ticker periódico (ver instrumentation.ts) os processa. Esse fallback
// sempre roda também, mesmo com Redis disponível, como uma segunda rede de
// segurança caso um job da fila se perca.

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const QUEUE_NAME = "automation-delays";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
let redisAvailable = false;

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: () => null, // não fica tentando reconectar sem parar se não existir
    });
    connection.on("error", () => {
      // silencioso de propósito — o estado "disponível" é controlado por initQueue()
    });
  }
  return connection;
}

export async function initQueue() {
  try {
    const conn = getConnection();
    await conn.connect();
    queue = new Queue(QUEUE_NAME, { connection: conn });
    worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { resumeAutomationRun } = await import("./engine");
        await resumeAutomationRun(job.data.runId as string);
      },
      { connection: conn }
    );
    worker.on("failed", (job, err) => {
      console.error("[automations] job da fila falhou:", job?.id, err);
    });
    redisAvailable = true;
    console.log("[automations] fila Redis/BullMQ conectada — agendamentos usam fila de verdade.");
  } catch {
    redisAvailable = false;
    console.warn(
      "[automations] Redis não disponível em", REDIS_URL,
      "— agendamentos vão funcionar via verificação periódica (menos preciso, não escala em várias instâncias). " +
      "Configure REDIS_URL e suba um Redis (Docker: `docker run -d -p 6379:6379 redis:alpine`) pra usar a fila de verdade."
    );
  }
}

// Agenda a retomada de um AutomationRun daqui a `delayMs`. Retorna o id do
// job na fila, ou null se caiu no modo de segurança (sem Redis).
export async function scheduleResume(runId: string, delayMs: number): Promise<string | null> {
  if (redisAvailable && queue) {
    const job = await queue.add("resume", { runId }, { delay: delayMs, jobId: runId });
    return job.id ?? null;
  }
  return null;
}

export async function cancelScheduledResume(jobId: string | null) {
  if (!jobId || !redisAvailable || !queue) return;
  const job = await queue.getJob(jobId);
  await job?.remove().catch(() => {});
}

export function isQueueAvailable() {
  return redisAvailable;
}
