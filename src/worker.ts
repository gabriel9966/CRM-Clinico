import { initQueue, closeQueue } from "./lib/automation/queue";
import { processDueSchedulesFallback, processDueTriggerAutomations } from "./lib/automation/engine";
import { processDueCampaigns } from "./lib/campaigns";

async function main() {
  await initQueue();
  let running: Promise<void> | null = null;
  let stopping = false;
  const tick = async () => {
    if (running || stopping) return;
    running = (async () => {
      for (const [name, process] of [["delays", processDueSchedulesFallback], ["triggers", processDueTriggerAutomations], ["campaigns", processDueCampaigns]] as const) {
        if (stopping) break;
        try { await process(); } catch (error) { console.error(`[worker:${name}]`, error); }
      }
    })().finally(() => { running = null; });
    await running;
  };
  await tick();
  const timer = setInterval(() => { void tick(); }, 30_000);
  console.log("[worker] automações e campanhas iniciadas");

  // Deploy envia SIGTERM: para de pegar trabalho novo, termina o que está em
  // andamento (envio de campanha, job da fila) e só então sai.
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} recebido, encerrando...`);
    clearInterval(timer);
    await running;
    await closeQueue();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
main().catch((error) => { console.error("[worker] falha de inicialização", error); process.exitCode = 1; });
