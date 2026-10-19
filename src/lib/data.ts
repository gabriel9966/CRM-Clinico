import "server-only";
import { prisma } from "./prisma";
import type {
  PipelineDTO,
  TeamMemberDTO,
  ConnectionDTO,
  AutomationDTO,
  AutomationRunDTO,
  CustomFieldDefinitionDTO,
  DuplicateContactGroupDTO,
  SegmentDTO,
  MessageTemplateDTO,
} from "./types";

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Todas as funções abaixo recebem `organizationId` e filtram por ele — é a
// fronteira de isolamento do multi-tenant. Nunca remova esse filtro.

export async function getPipelines(organizationId: string): Promise<PipelineDTO[]> {
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId },
    include: { stages: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return pipelines.map((p) => ({
    id: p.id,
    name: p.name,
    group: p.groupName,
    stages: p.stages.map((s) => ({
      id: s.id,
      label: s.label,
      color: s.color,
      order: s.order,
      status: s.status,
      requiredFields: parseTags(s.requiredFields),
      allowedTeams: parseTags(s.allowedTeams),
      requireLossReason: s.requireLossReason,
      automationIds: parseTags(s.automationIds),
      pipelineId: s.pipelineId,
    })),
  }));
}

// Agrupa contatos candidatos a duplicata por e-mail (normalizado) ou telefone
// (só dígitos). Contact não tem unique constraint nesses campos hoje, então
// duplicatas já existem na base — isso só detecta, a ação de mesclar é
// mergeContacts em app/contacts/actions.ts.
export const DUPLICATE_GROUPS_LIMIT = 50;

// A agregação roda no banco (GROUP BY ... HAVING count > 1) e só os contatos dos
// grupos achados são carregados. $queryRaw não passa pela extensão da lixeira,
// então "deletedAt" IS NULL é explícito.
export async function findDuplicateContacts(
  organizationId: string,
  limit = DUPLICATE_GROUPS_LIMIT
): Promise<DuplicateContactGroupDTO[]> {
  const [emailGroups, phoneGroups] = await Promise.all([
    prisma.$queryRaw<{ key: string; ids: string[] }[]>`
      SELECT lower(trim(email)) AS key, array_agg(id ORDER BY "createdAt", id) AS ids
      FROM "Contact"
      WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
        AND email IS NOT NULL AND trim(email) <> ''
      GROUP BY 1 HAVING count(*) > 1
      ORDER BY count(*) DESC, 1
      LIMIT ${limit}`,
    prisma.$queryRaw<{ key: string; ids: string[] }[]>`
      SELECT regexp_replace(phone, '\\D', '', 'g') AS key, array_agg(id ORDER BY "createdAt", id) AS ids
      FROM "Contact"
      WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
        AND phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') <> ''
      GROUP BY 1 HAVING count(*) > 1
      ORDER BY count(*) DESC, 1
      LIMIT ${limit}`,
  ]);

  const allIds = [...new Set([...emailGroups, ...phoneGroups].flatMap((g) => g.ids))];
  if (allIds.length === 0) return [];
  const rows = await prisma.contact.findMany({ where: { organizationId, id: { in: allIds } } });
  const byId = new Map(rows.map((c) => [c.id, c]));

  const build = (g: { key: string; ids: string[] }, matchedOn: "email" | "phone"): DuplicateContactGroupDTO => ({
    key: `${matchedOn}:${g.key}`,
    matchedOn,
    contacts: g.ids
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        email: c.email,
        phone: c.phone,
        tags: parseTags(c.tags),
        notes: c.notes,
        source: c.source,
        score: c.score,
        ownerId: c.ownerId,
        customFields: (c.customFields as Record<string, unknown>) ?? {},
        createdAt: c.createdAt.toISOString(),
      })),
  });

  return [...emailGroups.map((g) => build(g, "email")), ...phoneGroups.map((g) => build(g, "phone"))].filter(
    (g) => g.contacts.length > 1
  );
}

export async function getSegments(organizationId: string): Promise<SegmentDTO[]> {
  const segments = await prisma.segment.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  return segments.map((s) => ({
    id: s.id,
    name: s.name,
    entity: s.entity,
    filters: s.filters,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function getCustomFieldDefinitions(organizationId: string): Promise<CustomFieldDefinitionDTO[]> {
  const defs = await prisma.customFieldDefinition.findMany({
    where: { organizationId },
    orderBy: [{ entity: "asc" }, { order: "asc" }],
  });
  return defs.map((d) => ({
    id: d.id,
    entity: d.entity,
    key: d.key,
    label: d.label,
    group: d.group,
    type: d.type,
    options: parseTags(d.options),
    order: d.order,
  }));
}

export async function getMessageTemplates(organizationId: string): Promise<MessageTemplateDTO[]> {
  const rows = await prisma.messageTemplate.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    subject: t.subject,
    body: t.body,
    cloudApproved: t.cloudApproved,
    cloudTemplateName: t.cloudTemplateName,
    cloudLanguage: t.cloudLanguage,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function getConnections(organizationId: string): Promise<ConnectionDTO[]> {
  const rows = await prisma.connection.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  return rows.map((c) => ({
    id: c.id,
    provider: c.provider as ConnectionDTO["provider"],
    label: c.label,
    status: c.status as ConnectionDTO["status"],
    lastError: c.lastError,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function getAutomations(organizationId: string): Promise<AutomationDTO[]> {
  const rows = await prisma.automation.findMany({
    where: { organizationId },
    include: { _count: { select: { runs: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((a) => {
    let triggerConfig: Record<string, unknown> = {};
    let flow: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] };
    try {
      triggerConfig = JSON.parse(a.triggerConfig);
    } catch {}
    try {
      flow = JSON.parse(a.flow);
    } catch {}
    return {
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      trigger: a.trigger,
      triggerConfig,
      flow,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      runCount: a._count.runs,
    };
  });
}

/** Últimas execuções de automações da organização, incluindo falhas e o
 * último evento gravado pelo motor. Mantemos o log completo no banco; a lista
 * mostra só o resumo para ser consultável rapidamente. */
export async function getAutomationRuns(organizationId: string): Promise<AutomationRunDTO[]> {
  const rows = await prisma.automationRun.findMany({
    where: { automation: { organizationId } },
    include: { automation: { select: { id: true, name: true } } },
    orderBy: { startedAt: "desc" },
    take: 80,
  });

  return rows.map((run) => {
    let detail: string | null = null;
    try {
      const entries = JSON.parse(run.log) as Array<{ label?: unknown; result?: { reason?: unknown } }>;
      const last = entries.at(-1);
      if (last?.result?.reason) detail = String(last.result.reason);
      else if (last?.label) detail = String(last.label);
    } catch {
      // Um log antigo malformado não pode impedir a consulta do histórico.
    }
    return {
      id: run.id,
      automationId: run.automation.id,
      automationName: run.automation.name,
      status: run.status,
      contactId: run.contactId,
      opportunityId: run.opportunityId,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      detail,
    };
  });
}

export async function getAutomation(id: string, organizationId: string): Promise<AutomationDTO | null> {
  const a = await prisma.automation.findFirst({ where: { id, organizationId }, include: { _count: { select: { runs: true } } } });
  if (!a) return null;
  let triggerConfig: Record<string, unknown> = {};
  let flow: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] };
  try {
    triggerConfig = JSON.parse(a.triggerConfig);
  } catch {}
  try {
    flow = JSON.parse(a.flow);
  } catch {}
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    trigger: a.trigger,
    triggerConfig,
    flow,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    runCount: a._count.runs,
  };
}

export async function getGoogleConnectedUserIds(organizationId: string): Promise<Set<string>> {
  const rows = await prisma.googleAccount.findMany({ where: { user: { organizationId } }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

export async function getTeamMembers(organizationId: string): Promise<TeamMemberDTO[]> {
  const users = await prisma.user.findMany({
    where: { organizationId },
    include: { pipelineAccesses: true, connectionAccesses: true },
    orderBy: { createdAt: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    color: u.color,
    team: u.team,
    role: u.role,
    permissions: (() => { try { const value = JSON.parse(u.permissions); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } })(),
    accessConfigured: u.accessConfigured,
    dataScope: u.role === "ADMIN" ? "all" : u.dataScope,
    seeUnassigned: u.seeUnassigned,
    pipelineAccesses: u.pipelineAccesses.map((access) => ({ pipelineId: access.pipelineId, canView: access.canView, canEdit: access.canEdit })),
    connectionAccesses: u.connectionAccesses.map((access) => ({ connectionId: access.connectionId, canView: access.canView, canSend: access.canSend })),
    isActive: u.isActive,
  }));
}
