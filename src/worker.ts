import { initQueue } from "./lib/automation/queue";
import { processDueSchedulesFallback, processDueTriggerAutomations } from "./lib/automation/engine";
import { processDueCampaigns } from "./lib/campaigns";

async function main() {
  await initQueue();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const [name, process] of [["delays", processDueSchedulesFallback], ["triggers", processDueTriggerAutomations], ["campaigns", processDueCampaigns]] as const) {
        try { await process(); } catch (error) { console.error(`[worker:${name}]`, error); }
      }
    } finally { running = false; }
  };
  await tick();
  setInterval(() => { void tick(); }, 30_000);
  console.log("[worker] automações e campanhas iniciadas");
}
main().catch((error) => { console.error("[worker] falha de inicialização", error); process.exitCode = 1; });
