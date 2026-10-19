import "server-only";
import { executeIsolatedCode } from "./isolated-code";
import { syncTags } from "@/lib/crm-catalog";
import {
  mcpListContacts,
  mcpGetContact,
  mcpCreateContact,
  mcpListPipelines,
  mcpListOpportunities,
  mcpCreateOpportunity,
  mcpMoveOpportunityStage,
  mcpListTeam,
  mcpSendMessage,
} from "@/lib/mcp-tools";
import { prisma } from "@/lib/prisma";

type SandboxContext = {
  organizationId: string;
  contactId?: string | null;
  opportunityId?: string | null;
  payload?: unknown;
};

export type SandboxResult = {
  ok: boolean;
  logs: string[];
  error?: string;
  result?: unknown;
};

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Funções prontas do CRM, disponíveis como `crm.*` dentro do código JS do
// nó "Código". Reaproveitam a mesma lógica usada pelo servidor MCP, sempre
// restritas à organização dona da automação.
function buildCrmApi(ctx: SandboxContext, log: (...args: unknown[]) => void) {
  const orgId = ctx.organizationId;
  return {
    log,
    listContacts: (search?: string) => mcpListContacts(orgId, search),
    getContact: (contactId: string) => mcpGetContact(orgId, contactId),
    createContact: (data: Parameters<typeof mcpCreateContact>[1]) => mcpCreateContact(orgId, data),
    listPipelines: () => mcpListPipelines(orgId),
    listOpportunities: (filter?: Parameters<typeof mcpListOpportunities>[1]) => mcpListOpportunities(orgId, filter),
    createOpportunity: (data: Parameters<typeof mcpCreateOpportunity>[1]) => mcpCreateOpportunity(orgId, data),
    moveOpportunityStage: (opportunityId: string, stageId: string) => mcpMoveOpportunityStage(orgId, opportunityId, stageId),
    listTeam: () => mcpListTeam(orgId),
    sendMessage: (text: string, contactId?: string) => mcpSendMessage(orgId, contactId ?? ctx.contactId ?? "", text),
    addTag: async (tag: string, target: "contact" | "opportunity" = "contact", id?: string) => {
      if (target !== "contact" && target !== "opportunity") throw new Error("Tipo de registro inválido.");
      await syncTags(orgId, [tag], target);
      const targetId = id ?? (target === "contact" ? ctx.contactId : ctx.opportunityId);
      if (!targetId) return { ok: false, reason: "sem alvo" };
      if (target === "contact") {
        const c = await prisma.contact.findFirst({ where: { id: targetId, organizationId: orgId } });
        if (!c) return { ok: false, reason: "contato não encontrado" };
        const tags = parseTags(c.tags);
        if (!tags.includes(tag)) await prisma.contact.update({ where: { id: c.id }, data: { tags: JSON.stringify([...tags, tag]) } });
      } else {
        const o = await prisma.opportunity.findFirst({ where: { id: targetId, organizationId: orgId } });
        if (!o) return { ok: false, reason: "oportunidade não encontrada" };
        const tags = parseTags(o.tags);
        if (!tags.includes(tag)) await prisma.opportunity.update({ where: { id: o.id }, data: { tags: JSON.stringify([...tags, tag]) } });
      }
      return { ok: true };
    },
    createTask: async (title: string, opts: { dueInDays?: number; notes?: string } = {}) => {
      if (!ctx.contactId && !ctx.opportunityId) return { ok: false, reason: "sem contato/oportunidade" };
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          title,
          type: "TASK",
          notes: opts.notes,
          dueAt: new Date(Date.now() + (opts.dueInDays ?? 1) * 86400000),
          contactId: ctx.contactId ?? undefined,
          opportunityId: ctx.opportunityId ?? undefined,
        },
      });
      return { ok: true };
    },
  };
}

// QuickJS/WASM: heap próprio, sem objetos Node, com limite de memória,
// tempo síncrono/assíncrono e chamadas. O CRM expõe somente funções com JSON.
export async function runCode(code: string, ctx: SandboxContext): Promise<SandboxResult> {
  const logs: string[] = [];
  const sandboxConsole = {
    log: (...args: unknown[]) => { if (logs.length < 100) logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ").slice(0, 4000)); },
  };

  let contact = null;
  let opportunity = null;
  try {
    if (ctx.contactId) contact = await mcpGetContact(ctx.organizationId, ctx.contactId);
    if (ctx.opportunityId) {
      const opps = await mcpListOpportunities(ctx.organizationId, {});
      opportunity = opps.find((o) => o.id === ctx.opportunityId) ?? null;
    }
  } catch {
    // segue sem os dados resolvidos se a busca falhar
  }

  const sandbox = {
    payload: ctx.payload ?? null,
    appointment: ctx.payload && typeof ctx.payload === "object" ? (ctx.payload as { appointment?: unknown }).appointment ?? null : null,
    contact,
    opportunity,
  };

  try {
    const result = await executeIsolatedCode(code, sandbox, buildCrmApi(ctx, sandboxConsole.log), sandboxConsole.log);
    return { ok: true, logs, result };
  } catch (err) {
    return { ok: false, logs, error: err instanceof Error ? err.message : String(err) };
  }
}
