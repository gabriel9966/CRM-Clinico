export type ContactDTO = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  notes: string | null;
  source: string | null;
  score: number;
  ownerId: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
};

/** Página de resultados por cursor. `total` só vem na primeira página (ou null quando não faz sentido). */
export type Page<T> = { items: T[]; nextCursor: string | null; total: number | null };

export type ContactRowDTO = ContactDTO & { dealsCount: number };

export type DealCardDTO = OpportunityDTO & { contactName: string | null; contactCompany?: string | null; nextActivity?: { title: string; dueAt: string } | null; channel?: string | null; products?: string[] };

export type ConversationRowDTO = {
  id: string;
  contact: ContactDTO;
  lastText: string | null;
  lastTime: string | null;
  lastDirection: "in" | "out" | null;
  lastInboundAt: string | null;
  status: "OPEN" | "CLOSED";
  ownerId: string | null;
  channel: ConversationChannelInfo;
  /** O agente de IA está pausado nesta conversa (atendimento humano). */
  aiPaused: boolean;
};

export type StageDTO = {
  id: string;
  label: string;
  color: string;
  order: number;
  /** Status operacional; não depende do nome que aparece no funil. */
  status: "OPEN" | "WON" | "LOST";
  pipelineId: string;
  requiredFields: string[];
  allowedTeams: string[];
  requireLossReason: boolean;
  automationIds: string[];
};

export type PipelineDTO = {
  id: string;
  name: string;
  group: string;
  stages: StageDTO[];
};

export type OpportunityDTO = {
  id: string;
  title: string;
  value: number;
  tags: string[];
  contactId: string;
  pipelineId: string;
  stageId: string;
  ownerId: string | null;
  expectedClose: string | null;
  lossReason: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
};

export type SegmentDTO = {
  id: string;
  name: string;
  entity: "CONTACT" | "OPPORTUNITY";
  filters: string;
  createdAt: string;
};

export type DuplicateContactGroupDTO = {
  key: string;
  matchedOn: "email" | "phone";
  contacts: ContactDTO[];
};

export type StageHistoryDTO = {
  id: string;
  opportunityId: string;
  stageId: string;
  enteredAt: string;
  exitedAt: string | null;
};

export type MessageDTO = {
  id: string;
  text: string;
  direction: "in" | "out";
  time: string;
  contactId: string;
  senderId: string | null;
  /** "sent" ou "failed" (o provedor recusou o envio). */
  status: string;
  conversationId: string | null;
};

/** Canal pelo qual se pode falar com um contato (WhatsApp, Instagram ou e-mail). */
export type SendOptionDTO = {
  connectionId: string;
  provider: "WHATSAPP_EVOLUTION" | "WHATSAPP_AZAP" | "WHATSAPP_CLOUD" | "INSTAGRAM" | "EMAIL";
  label: string;
  /** Conexão ativa agora; desconectada não envia. */
  connected: boolean;
  /** O contato já tem conversa por este canal (senão será iniciada no primeiro envio). */
  existing: boolean;
};

export type AppointmentDTO = {
  id: string;
  title: string;
  notes: string | null;
  startAt: string;
  endAt: string;
  status: "SCHEDULED" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  googleEventId: string | null;
  contactId: string | null;
  ownerId: string | null;
};

export type ActivityDTO = {
  id: string;
  type: "TASK" | "CALL" | "MEETING";
  title: string;
  notes: string | null;
  tags: string[];
  collaboratorIds: string[];
  dueAt: string;
  done: boolean;
  createdAt: string;
  contactId: string | null;
  opportunityId: string | null;
  assigneeId: string | null;
};

export type TrashEntity = "contact" | "opportunity" | "appointment";

export type TrashItemDTO = {
  entity: TrashEntity;
  id: string;
  title: string;
  detail: string | null;
  deletedAt: string;
};

export type ActivityRowDTO = ActivityDTO & {
  contactName: string | null;
  opportunityTitle: string | null;
  /** Pendente e já vencida (calculado no servidor, no momento da consulta). */
  overdue: boolean;
};

export type AppointmentRowDTO = AppointmentDTO & { contactName: string | null };

export type AutomationDTO = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  triggerConfig: Record<string, unknown>;
  flow: { nodes: unknown[]; edges: unknown[] };
  createdAt: string;
  updatedAt: string;
  runCount: number;
};

export type AutomationRunDTO = {
  id: string;
  automationId: string;
  automationName: string;
  status: "RUNNING" | "WAITING" | "COMPLETED" | "FAILED";
  contactId: string | null;
  opportunityId: string | null;
  startedAt: string;
  finishedAt: string | null;
  detail: string | null;
};

export type ConnectionDTO = {
  id: string;
  provider: "WHATSAPP_EVOLUTION" | "WHATSAPP_AZAP" | "WHATSAPP_CLOUD" | "INSTAGRAM" | "EMAIL";
  label: string;
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
  lastError: string | null;
  createdAt: string;
};

export type TeamMemberDTO = {
  id: string;
  name: string;
  email: string;
  color: string;
  team: string;
  role: "ADMIN" | "MEMBER";
  permissions: string[];
  accessConfigured: boolean;
  pipelineAccesses: { pipelineId: string; canView: boolean; canEdit: boolean }[];
  connectionAccesses: { connectionId: string; canView: boolean; canSend: boolean }[];
  isActive: boolean;
};

export type CustomFieldDefinitionDTO = {
  id: string;
  entity: "CONTACT" | "OPPORTUNITY";
  key: string;
  label: string;
  group: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";
  options: string[];
  order: number;
};

export type ConversationChannelInfo = {
  provider: "WHATSAPP_EVOLUTION" | "WHATSAPP_AZAP" | "WHATSAPP_CLOUD" | "INSTAGRAM" | "EMAIL";
  label: string;
  externalName: string | null;
  connectionId: string;
} | null;

export type ConversationEventDTO = {
  id: string;
  action: "assigned" | "transferred" | "claimed" | "closed" | "reopened" | "tag_added" | "tag_removed";
  actorName: string | null;
  detail: string;
  createdAt: string;
};

export type MessageTemplateDTO = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  cloudApproved: boolean;
  cloudTemplateName: string | null;
  cloudLanguage: string;
  createdAt: string;
};

export type CampaignDTO = {
  id: string;
  name: string;
  body: string;
  status: "DRAFT" | "SCHEDULED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED";
  scheduledAt: string | null;
  createdAt: string;
  connectionId: string;
  connectionLabel: string;
  connectionProvider: ConnectionDTO["provider"];
  segmentId: string | null;
  segmentName: string | null;
  sendLimit: number;
  batchSize: number;
  intervalMinutes: number;
  duplicateWindowHours: number;
  dailyLimit: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  metrics: { total: number; pending: number; sent: number; delivered: number; read: number; responded: number; failed: number; skipped: number; conversions: number };
  recipients: Array<{ id: string; contactId: string; contactName: string; status: string; failureReason: string | null; sentAt: string | null; optedOut: boolean }>;
};
