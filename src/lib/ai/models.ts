// Catálogo do agente de IA (seguro para o navegador: sem acesso a banco ou chave).

export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — o mais capaz", price: "US$ 4 entrada / US$ 20 saída por 1M de tokens" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — equilíbrio entre qualidade e custo", price: "US$ 2 entrada / US$ 10 saída por 1M de tokens" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — o mais rápido e barato", price: "US$ 0,10 entrada / US$ 0,50 saída por 1M de tokens" },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]["id"];
export const DEFAULT_AI_MODEL: AiModelId = "claude-opus-5-5";

export const AI_EFFORTS = [
  { id: "low", label: "Baixo — respostas mais rápidas e baratas" },
  { id: "medium", label: "Médio — recomendado para atendimento" },
  { id: "high", label: "Alto — raciocínio mais cuidadoso (mais lento e caro)" },
] as const;
export type AiEffort = (typeof AI_EFFORTS)[number]["id"];

export function isAiModel(value: string): value is AiModelId {
  return AI_MODELS.some((m) => m.id === value);
}

export function isAiEffort(value: string): value is AiEffort {
  return AI_EFFORTS.some((e) => e.id === value);
}

/** Fallback server-side da Anthropic em caso de recusa: só Opus 5.5 e Sonnet 5.5 (Haiku não tem). */
export function supportsRefusalFallback(model: string) {
  return model === "claude-opus-5-5" || model === "claude-sonnet-5-5";
}

export type AiToolName =
  | "get_contact"
  | "save_contact_info"
  | "list_procedures"
  | "list_professionals"
  | "get_availability"
  | "book_appointment"
  | "list_my_appointments"
  | "reschedule_appointment"
  | "cancel_appointment"
  | "create_follow_up_task";

export type AiToolInfo = {
  name: AiToolName;
  label: string;
  description: string;
  /** Altera dados (agenda, contato, tarefas). As de leitura não alteram nada. */
  writes: boolean;
  defaultOn: boolean;
};

// "Passar para humano" (handoff_to_human) é sempre ligada: é a rede de segurança.
export const AI_TOOLS: AiToolInfo[] = [
  { name: "list_procedures", label: "Consultar procedimentos e preços", description: "Lê o catálogo de procedimentos (nome, duração, valor).", writes: false, defaultOn: true },
  { name: "list_professionals", label: "Consultar profissionais", description: "Lê quem atende e a especialidade.", writes: false, defaultOn: true },
  { name: "get_availability", label: "Consultar horários livres", description: "Vê horários disponíveis na agenda.", writes: false, defaultOn: true },
  { name: "get_contact", label: "Ver dados do paciente", description: "Lê só o primeiro nome, etiquetas e se há telefone/e-mail.", writes: false, defaultOn: true },
  { name: "list_my_appointments", label: "Ver agendamentos do paciente", description: "Lista os próximos agendamentos do próprio paciente.", writes: false, defaultOn: true },
  { name: "book_appointment", label: "Agendar atendimento", description: "Marca um horário livre para o paciente (máx. 2 por conversa).", writes: true, defaultOn: false },
  { name: "reschedule_appointment", label: "Remarcar atendimento", description: "Muda o horário de um agendamento do próprio paciente.", writes: true, defaultOn: false },
  { name: "cancel_appointment", label: "Cancelar atendimento", description: "Cancela um agendamento futuro do próprio paciente.", writes: true, defaultOn: false },
  { name: "save_contact_info", label: "Atualizar nome e e-mail", description: "Corrige o nome ou o e-mail do paciente na ficha.", writes: true, defaultOn: false },
  { name: "create_follow_up_task", label: "Criar tarefa para a equipe", description: "Cria uma tarefa de acompanhamento para um humano.", writes: true, defaultOn: true },
];

export const AI_TOOL_NAMES = AI_TOOLS.map((t) => t.name);

export function parseToolNames(raw: string | null | undefined): AiToolName[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is AiToolName => typeof n === "string" && (AI_TOOL_NAMES as string[]).includes(n));
  } catch {
    return [];
  }
}

export const DEFAULT_INSTRUCTIONS = `Você é a assistente virtual da clínica. Atenda com simpatia e objetividade.

Sobre a clínica:
- Nome: (preencha)
- Endereço e horário de funcionamento: (preencha)
- Formas de pagamento: (preencha)

Como atender:
- Tire dúvidas sobre os procedimentos usando SEMPRE as ferramentas (não invente preços, duração ou horários).
- Para agendar: entenda o procedimento, ofereça 2 ou 3 horários livres e só confirme depois que o paciente escolher.
- Dúvidas clínicas (dor, reação, medicamentos, resultados) e reclamações: passe para um atendente humano.`;
