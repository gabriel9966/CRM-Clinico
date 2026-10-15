export type ActionType = "send_message" | "create_task" | "move_stage" | "add_tag" | "assign_owner" | "webhook";

export type NodeData =
  | { kind: "trigger"; label: string }
  | { kind: "action"; actionType: ActionType; config: Record<string, unknown> }
  | { kind: "condition"; field: string; operator: string; value: string }
  | { kind: "delay"; amount: number; unit: "minutes" | "hours" | "days" }
  | { kind: "code"; code: string };

export type FlowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: NodeData;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};

export type Flow = { nodes: FlowNode[]; edges: FlowEdge[] };

export const ACTION_LABEL: Record<ActionType, string> = {
  send_message: "Enviar mensagem",
  create_task: "Criar tarefa",
  move_stage: "Mover de etapa",
  add_tag: "Adicionar tag",
  assign_owner: "Atribuir responsável",
  webhook: "Chamar webhook",
};

export const TRIGGER_LABEL: Record<string, string> = {
  STAGE_CHANGED: "Oportunidade muda de etapa",
  CONTACT_CREATED: "Novo contato criado",
  OPPORTUNITY_CREATED: "Nova oportunidade criada",
  TAG_ADDED: "Tag adicionada ao contato",
  MESSAGE_RECEIVED: "Mensagem recebida",
  WEBHOOK_RECEIVED: "Webhook recebido (HTTP externo)",
};
