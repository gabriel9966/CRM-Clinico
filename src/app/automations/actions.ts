"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import type { Flow } from "@/lib/automation/types";
import { TRIGGER_LABEL } from "@/lib/automation/types";
import { actorOf, audit } from "@/lib/audit";

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
  const user = await requireAdminUser();
  const { organizationId } = user;
  const automation = await prisma.automation.create({
    data: {
      organizationId,
      name: name.trim() || "Nova automação",
      trigger: trigger as never,
      flow: JSON.stringify(initialFlow(trigger)),
    },
  });
  await audit(organizationId, { action: "automation.created", entity: "Automation", entityId: automation.id, ...actorOf(user), meta: { trigger } });
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

/** Atalhos operacionais seguros: criam a automação ativa, mas não enviam
 * mensagens sem revisão humana. O atendente recebe uma tarefa no CRM. */
export async function createAutomationRecipe(recipe: "lead_follow_up" | "inbox_task") {
  const { organizationId } = await requireAdminUser();
  const leadFollowUp = recipe === "lead_follow_up";
  const trigger = leadFollowUp ? "CONTACT_CREATED" : "MESSAGE_RECEIVED";
  const flow: Flow = leadFollowUp
    ? {
        nodes: [
          { id: "trigger", type: "triggerNode", position: { x: 60, y: 160 }, data: { kind: "trigger", label: trigger } },
          { id: "wait", type: "delayNode", position: { x: 320, y: 160 }, data: { kind: "delay", amount: 1, unit: "days" } },
          { id: "task", type: "actionNode", position: { x: 580, y: 160 }, data: { kind: "action", actionType: "create_task", config: { title: "Fazer primeiro contato", dueInDays: 0 } } },
        ],
        edges: [{ id: "e1", source: "trigger", target: "wait" }, { id: "e2", source: "wait", target: "task" }],
      }
    : {
        nodes: [
          { id: "trigger", type: "triggerNode", position: { x: 60, y: 160 }, data: { kind: "trigger", label: trigger } },
          { id: "task", type: "actionNode", position: { x: 360, y: 160 }, data: { kind: "action", actionType: "create_task", config: { title: "Responder mensagem recebida", dueInDays: 0 } } },
        ],
        edges: [{ id: "e1", source: "trigger", target: "task" }],
      };

  await prisma.automation.create({
    data: {
      organizationId,
      name: leadFollowUp ? "Follow-up de novo lead" : "Tarefa para mensagem recebida",
      trigger: trigger as never,
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
  const user = await requireAdminUser();
  const { organizationId } = user;
  const updated = await prisma.automation.updateMany({ where: { id, organizationId }, data: { enabled } });
  if (updated.count) await audit(organizationId, { action: enabled ? "automation.enabled" : "automation.disabled", entity: "Automation", entityId: id, ...actorOf(user) });
  revalidatePath("/automations");
}

export async function updateTriggerConfig(id: string, triggerConfig: Record<string, unknown>) {
  const user = await requireAdminUser();
  const { organizationId } = user;
  const updated = await prisma.automation.updateMany({ where: { id, organizationId }, data: { triggerConfig: JSON.stringify(triggerConfig) } });
  if (updated.count) await audit(organizationId, { action: "automation.trigger_configured", entity: "Automation", entityId: id, ...actorOf(user) });
  revalidatePath(`/automations/${id}`);
}

export async function saveFlow(id: string, flow: Flow, trigger: string, triggerConfig: Record<string, unknown>) {
  const user = await requireAdminUser();
  const { organizationId } = user;
  if (!Object.hasOwn(TRIGGER_LABEL, trigger)) throw new Error("Gatilho inválido");
  const current = await prisma.automation.findFirst({ where: { id, organizationId }, select: { trigger: true } });
  if (!current) throw new Error("Automação não encontrada");
  const updated = await prisma.automation.updateMany({
    where: { id, organizationId },
    data: {
      flow: JSON.stringify(flow),
      trigger: trigger as never,
      triggerConfig: JSON.stringify(triggerConfig),
      ...(current.trigger !== trigger ? { lastTriggeredAt: null } : {}),
    },
  });
  if (updated.count) await audit(organizationId, { action: "automation.flow_saved", entity: "Automation", entityId: id, ...actorOf(user), meta: { nodes: flow.nodes.length, edges: flow.edges.length, trigger, previousTrigger: current.trigger } });
  revalidatePath(`/automations/${id}`);
}

export async function deleteAutomation(id: string) {
  const user = await requireAdminUser();
  const { organizationId } = user;
  const deleted = await prisma.automation.deleteMany({ where: { id, organizationId } });
  if (deleted.count) await audit(organizationId, { action: "automation.deleted", entity: "Automation", entityId: id, ...actorOf(user) });
  revalidatePath("/automations");
}
