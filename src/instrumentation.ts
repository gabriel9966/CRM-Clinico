export async function register() {
  // Só no runtime Node.js (não no Edge).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { initQueue } = await import("@/lib/automation/queue");
  await initQueue();

  // Rede de segurança: processa agendamentos vencidos direto do banco a cada
  // 60s, mesmo com a fila Redis/BullMQ disponível (cobre o caso raro de um
  // job se perder). Se o Redis não estiver configurado, essa é a ÚNICA forma
  // dos nós de "Espera" avançarem — então aqui o intervalo importa mais.
  const { processDueSchedulesFallback } = await import("@/lib/automation/engine");
  setInterval(() => {
    processDueSchedulesFallback().catch((err) => {
      console.error("[automations] erro ao processar agendamentos (fallback):", err);
    });
  }, 60_000);
}
