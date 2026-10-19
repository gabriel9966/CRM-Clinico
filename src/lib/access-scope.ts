import type { ModulePermission } from "./access-policy";

// Níveis de acesso: o que cada pessoa pode fazer (módulos), em quais pipelines
// e instâncias, e QUAL CARTEIRA enxerga (só os dela, da equipe ou todos).
// Arquivo puro (sem banco): usado no servidor e na tela de Equipe.

export type DataScope = "own" | "team" | "all";

export const DATA_SCOPES: { id: DataScope; label: string; help: string }[] = [
  { id: "own", label: "Só os meus", help: "Vê e atende apenas contatos, negócios e conversas em que é o responsável." },
  { id: "team", label: "Da minha equipe", help: "Vê os da própria equipe (campo Equipe), inclusive dos colegas." },
  { id: "all", label: "Todos da empresa", help: "Vê toda a carteira da empresa (gestores, supervisão)." },
];

export function isDataScope(value: unknown): value is DataScope {
  return value === "own" || value === "team" || value === "all";
}

/** Responsáveis visíveis; null = sem restrição (todos). */
export type OwnerScope = { ids: string[]; includeUnassigned: boolean } | null;

/** Cláusula Prisma para o campo de responsável (ownerId por padrão). */
export function scopeWhere(scope: OwnerScope, field = "ownerId"): Record<string, unknown> {
  if (!scope) return {};
  const or: Record<string, unknown>[] = [{ [field]: { in: scope.ids } }];
  if (scope.includeUnassigned) or.push({ [field]: null });
  return { OR: or };
}

export function ownerInScope(scope: OwnerScope, ownerId: string | null | undefined) {
  if (!scope) return true;
  if (!ownerId) return scope.includeUnassigned;
  return scope.ids.includes(ownerId);
}

export const PERMISSION_INFO: Record<ModulePermission, { area: string; label: string }> = {
  "contacts.read": { area: "Contatos", label: "Ver contatos" },
  "contacts.write": { area: "Contatos", label: "Criar e editar contatos" },
  "pipeline.read": { area: "Pipeline", label: "Ver negócios" },
  "pipeline.write": { area: "Pipeline", label: "Criar, mover e editar negócios" },
  "conversations.read": { area: "Conversas", label: "Ver conversas" },
  "conversations.reply": { area: "Conversas", label: "Responder clientes" },
  "conversations.manage": { area: "Conversas", label: "Atribuir, transferir e encerrar atendimentos" },
  "agenda.read": { area: "Agenda e tarefas", label: "Ver agenda e tarefas" },
  "agenda.write": { area: "Agenda e tarefas", label: "Criar e editar agendamentos e tarefas" },
  "campaigns.read": { area: "Campanhas", label: "Ver campanhas" },
  "campaigns.write": { area: "Campanhas", label: "Criar e disparar campanhas" },
  "automations.read": { area: "Automações", label: "Ver automações" },
  "automations.write": { area: "Automações", label: "Criar e editar automações" },
  "reports.read": { area: "Relatórios", label: "Ver dashboard e relatórios" },
  "data.import_export": { area: "Dados", label: "Importar e exportar planilhas" },
};

export type AccessProfile = {
  id: string;
  label: string;
  description: string;
  role: "ADMIN" | "MEMBER";
  dataScope: DataScope;
  seeUnassigned: boolean;
  permissions: ModulePermission[];
};

const ATTEND: ModulePermission[] = ["contacts.read", "contacts.write", "conversations.read", "conversations.reply", "agenda.read", "agenda.write"];

/** Perfis prontos: ponto de partida, cada item continua ajustável. */
export const ACCESS_PROFILES: AccessProfile[] = [
  {
    id: "attendant",
    label: "Atendente / SDR",
    description: "Atende só os próprios leads e pega novos da fila. Agenda e cria tarefas.",
    role: "MEMBER",
    dataScope: "own",
    seeUnassigned: true,
    permissions: [...ATTEND, "pipeline.read"],
  },
  {
    id: "seller",
    label: "Vendedor / Consultor",
    description: "Trabalha a própria carteira: conversas, negócios e agenda.",
    role: "MEMBER",
    dataScope: "own",
    seeUnassigned: false,
    permissions: [...ATTEND, "pipeline.read", "pipeline.write"],
  },
  {
    id: "reception",
    label: "Recepção / Agenda",
    description: "Vê todos os pacientes para agendar e confirmar; não mexe no funil.",
    role: "MEMBER",
    dataScope: "all",
    seeUnassigned: true,
    permissions: ["contacts.read", "contacts.write", "conversations.read", "conversations.reply", "agenda.read", "agenda.write"],
  },
  {
    id: "supervisor",
    label: "Supervisor de equipe",
    description: "Acompanha e redistribui os atendimentos da própria equipe.",
    role: "MEMBER",
    dataScope: "team",
    seeUnassigned: true,
    permissions: [...ATTEND, "pipeline.read", "pipeline.write", "conversations.manage", "reports.read"],
  },
  {
    id: "manager",
    label: "Gestor",
    description: "Vê toda a empresa, relatórios, campanhas e automações, sem administrar usuários.",
    role: "MEMBER",
    dataScope: "all",
    seeUnassigned: true,
    permissions: [...ATTEND, "pipeline.read", "pipeline.write", "conversations.manage", "reports.read", "campaigns.read", "campaigns.write", "automations.read", "data.import_export"],
  },
  {
    id: "admin",
    label: "Administrador",
    description: "Acesso total, inclusive equipe, conexões, IA e configurações.",
    role: "ADMIN",
    dataScope: "all",
    seeUnassigned: true,
    permissions: [],
  },
];

/** Qual perfil pronto corresponde exatamente a esta configuração (ou "custom"). */
export function matchProfile(input: { role: string; dataScope: string; seeUnassigned: boolean; permissions: string[] }) {
  if (input.role === "ADMIN") return "admin";
  const set = [...input.permissions].sort().join("|");
  const found = ACCESS_PROFILES.find(
    (p) => p.role === "MEMBER" && p.dataScope === input.dataScope && p.seeUnassigned === input.seeUnassigned && [...p.permissions].sort().join("|") === set
  );
  return found?.id ?? "custom";
}
