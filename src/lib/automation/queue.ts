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
let connectedOnce = false;

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      // Sem Redis na partida: desiste logo (modo de segurança). Se já conectou
      // antes, reconecta — um reinício do Redis não pode matar a fila de vez.
      retryStrategy: (times) => (connectedOnce ? Math.min(times * 500, 5_000) : null),
    });
    connection.on("error", () => {
      // silencioso de propósito — o estado "disponível" é controlado por initQueue()
    });
  }
  return connection;
}

export async function initQueue(options: { worker?: boolean } = {}) {
  try {
    const conn = getConnection();
    await conn.connect();
    connectedOnce = true;
    queue = new Queue(QUEUE_NAME, { connection: conn });
    if (options.worker !== false) worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { resumeAutomationRun } = await import("./engine");
        await resumeAutomationRun(job.data.runId as string);
      },
      { connection: conn }
    );
    worker?.on("failed", (job, err) => {
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
  // Redis caído no meio do caminho: devolve null e o agendamento fica só no
  // banco (o ticker de segurança retoma), em vez de travar a automação.
  if (redisAvailable && queue && connection?.status === "ready") {
    try {
      const job = await queue.add("resume", { runId }, { delay: delayMs, jobId: runId });
      return job.id ?? null;
    } catch (err) {
      console.error("[automations] falha ao enfileirar retomada, usando o banco:", err);
    }
  }
  return null;
}

// Desligamento limpo (SIGTERM no deploy): o worker termina o job em andamento
// em vez de abandoná-lo, o que faria o BullMQ reexecutá-lo depois.
export async function closeQueue() {
  await worker?.close().catch(() => {});
  await queue?.close().catch(() => {});
  connection?.disconnect();
}

export async function cancelScheduledResume(jobId: string | null) {
  if (!jobId || !redisAvailable || !queue) return;
  const job = await queue.getJob(jobId);
  await job?.remove().catch(() => {});
}

export function isQueueAvailable() {
  return redisAvailable;
}
