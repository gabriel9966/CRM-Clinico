export type ContactDTO = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  notes: string | null;
  ownerId: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
};

/** Página de resultados por cursor. `total` só vem na primeira página (ou null quando não faz sentido). */
export type Page<T> = { items: T[]; nextCursor: string | null; total: number | null };

export type ContactRowDTO = ContactDTO & { dealsCount: number };

export type DealCardDTO = OpportunityDTO & { contactName: string | null };

export type ConversationRowDTO = {
  contact: ContactDTO;
  lastText: string | null;
  lastTime: string | null;
  lastDirection: "in" | "out" | null;
};

export type StageDTO = {
  id: string;
  label: string;
  color: string;
  order: number;
  pipelineId: string;
};

export type PipelineDTO = {
  id: string;
  name: string;
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

export type ConnectionDTO = {
  id: string;
  provider: "WHATSAPP_EVOLUTION" | "INSTAGRAM" | "EMAIL";
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
  role: "ADMIN" | "MEMBER";
  isActive: boolean;
};

export type CustomFieldDefinitionDTO = {
  id: string;
  entity: "CONTACT" | "OPPORTUNITY";
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";
  options: string[];
  order: number;
};

export type ConversationChannelInfo = {
  provider: "WHATSAPP_EVOLUTION" | "INSTAGRAM" | "EMAIL";
  label: string;
  externalName: string | null;
} | null;

export type MessageTemplateDTO = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  createdAt: string;
};
