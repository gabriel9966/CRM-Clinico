"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import type { Flow } from "@/lib/automation/types";
import { TRIGGER_LABEL } from "@/lib/automation/types";

function initialFlow(triggerLabel: string): Flow {
  return {
    nodes: [
      {
        id: "trigger",
        type: "triggerNode",
        position: { x: 60, y: 160 },
        data: { kind: "trigger", label: triggerLabel },
      },
    ],
    edges: [],
  };
}

export async function createAutomation(name: string, trigger: string) {
  const { organizationId } = await requireAdminUser();
  const automation = await prisma.automation.create({
    data: {
      organizationId,
      name: name.trim() || "Nova automação",
      trigger: trigger as never,
      flow: JSON.stringify(initialFlow(trigger)),
    },
  });
  revalidatePath("/automations");
  redirect(`/automations/${automation.id}`);
}

// Atalho pra criar uma automação pronta de "resposta rápida": gatilho
// MESSAGE_RECEIVED ligado direto a um nó de ação send_message com o texto
// configurado — monta o Flow (nodes/edges do React Flow) programaticamente
// em vez de abrir o editor visual completo, pro caso simples de auto-resposta.
export async function createQuickReply(name: string, text: string) {
  const { organizationId } = await requireAdminUser();
  const trimmedName = name.trim();
  const trimmedText = text.trim();
  if (!trimmedName || !trimmedText) return;

  const flow: Flow = {
    nodes: [
      { id: "trigger", type: "triggerNode", position: { x: 60, y: 160 }, data: { kind: "trigger", label: TRIGGER_LABEL.MESSAGE_RECEIVED } },
      { id: "reply", type: "actionNode", position: { x: 340, y: 160 }, data: { kind: "action", actionType: "send_message", config: { text: trimmedText } } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "reply" }],
  };

  await prisma.automation.create({
    data: {
      organizationId,
      name: trimmedName,
      trigger: "MESSAGE_RECEIVED",
      flow: JSON.stringify(flow),
    },
  });
  revalidatePath("/automations");
}

export async function renameAutomation(id: string, name: string) {
  const { organizationId } = await requireAdminUser();
  await prisma.automation.updateMany({ where: { id, organizationId }, data: { name: name.trim() || "Automação" } });
  revalidatePath("/automations");
}

export async function toggleAutomation(id: string, enabled: boolean) {
  const { organizationId } = await requireAdminUser();
  await prisma.automation.updateMany({ where: { id, organizationId }, data: { enabled } });
  revalidatePath("/automations");
}

export async function updateTriggerConfig(id: string, triggerConfig: Record<string, unknown>) {
  const { organizationId } = await requireAdminUser();
  await prisma.automation.updateMany({ where: { id, organizationId }, data: { triggerConfig: JSON.stringify(triggerConfig) } });
  revalidatePath(`/automations/${id}`);
}

export async function saveFlow(id: string, flow: Flow) {
  const { organizationId } = await requireAdminUser();
  await prisma.automation.updateMany({ where: { id, organizationId }, data: { flow: JSON.stringify(flow) } });
  revalidatePath(`/automations/${id}`);
}

export async function deleteAutomation(id: string) {
  const { organizationId } = await requireAdminUser();
  await prisma.automation.deleteMany({ where: { id, organizationId } });
  revalidatePath("/automations");
}
