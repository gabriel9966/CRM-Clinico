"use client";

import { useCallback, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { NODE_TYPES } from "./nodes";
import type { ActionType, NodeData } from "@/lib/automation/types";
import { ACTION_LABEL, TRIGGER_LABEL } from "@/lib/automation/types";
import type { AutomationDTO, PipelineDTO, TeamMemberDTO } from "@/lib/types";
import { renameAutomation, saveFlow, toggleAutomation } from "@/app/automations/actions";

type PaletteItem =
  | { kind: "action"; actionType: ActionType; label: string }
  | { kind: "condition"; label: string }
  | { kind: "delay"; label: string }
  | { kind: "code"; label: string };

const PALETTE: PaletteItem[] = [
  { kind: "action", actionType: "send_message", label: ACTION_LABEL.send_message },
  { kind: "action", actionType: "create_task", label: ACTION_LABEL.create_task },
  { kind: "action", actionType: "move_stage", label: ACTION_LABEL.move_stage },
  { kind: "action", actionType: "add_tag", label: ACTION_LABEL.add_tag },
  { kind: "action", actionType: "assign_owner", label: ACTION_LABEL.assign_owner },
  { kind: "action", actionType: "webhook", label: ACTION_LABEL.webhook },
  { kind: "action", actionType: "create_contact", label: ACTION_LABEL.create_contact },
  { kind: "action", actionType: "create_opportunity", label: ACTION_LABEL.create_opportunity },
  { kind: "condition", label: "Condição" },
  { kind: "delay", label: "Espera" },
  { kind: "code", label: "Código JS" },
];

const DEFAULT_CODE = `// 'payload' = dados recebidos (gatilho de webhook)
// 'contact' / 'opportunity' = dados resolvidos do contexto atual
// 'crm.*' = funções prontas do CRM (veja a dica abaixo)

crm.log("payload recebido:", payload);
`;

function defaultDataFor(item: PaletteItem): NodeData {
  if (item.kind === "action") {
    const config: Record<string, unknown> =
      item.actionType === "send_message"
        ? { text: "" }
        : item.actionType === "create_task"
          ? { title: "Tarefa automática", dueInDays: 1 }
          : item.actionType === "move_stage"
            ? { stageId: "" }
            : item.actionType === "add_tag"
              ? { tag: "", target: "contact" }
              : item.actionType === "assign_owner"
                ? { ownerId: "", target: "contact" }
                : item.actionType === "create_contact"
                  ? { name: "{{payload.name}}", email: "{{payload.email}}", phone: "{{payload.phone}}", company: "{{payload.company}}" }
                  : item.actionType === "create_opportunity"
                    ? { title: "Nova oportunidade", pipelineId: "", stageId: "", value: 0 }
                    : { url: "" };
    return { kind: "action", actionType: item.actionType, config };
  }
  if (item.kind === "condition") {
    return { kind: "condition", field: "contact_tag", operator: "equals", value: "" };
  }
  if (item.kind === "code") {
    return { kind: "code", code: DEFAULT_CODE };
  }
  return { kind: "delay", amount: 1, unit: "hours" };
}

function nodeTypeFor(kind: NodeData["kind"]) {
  if (kind === "trigger") return "triggerNode";
  if (kind === "action") return "actionNode";
  if (kind === "condition") return "conditionNode";
  if (kind === "code") return "codeNode";
  return "delayNode";
}

export function FlowEditor({
  automation,
  pipelines,
  team,
  webhookPath,
}: {
  automation: AutomationDTO;
  pipelines: PipelineDTO[];
  team: TeamMemberDTO[];
  /** Caminho do webhook já com o token (ex.: /api/webhooks/automation/ID?token=...). */
  webhookPath: string;
}) {
  return (
    <ReactFlowProvider>
      <Editor automation={automation} pipelines={pipelines} team={team} webhookPath={webhookPath} />
    </ReactFlowProvider>
  );
}

function Editor({
  automation,
  pipelines,
  team,
  webhookPath,
}: {
  automation: AutomationDTO;
  pipelines: PipelineDTO[];
  team: TeamMemberDTO[];
  webhookPath: string;
}) {
  const router = useRouter();
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const initialNodes: Node[] = (automation.flow.nodes as Array<{ id: string; position: { x: number; y: number }; data: NodeData }>).map((n) => ({
    id: n.id,
    type: nodeTypeFor(n.data.kind),
    position: n.position,
    data: n.data as unknown as Record<string, unknown>,
    deletable: n.data.kind !== "trigger",
  }));
  const initialEdges: Edge[] = automation.flow.edges as Edge[];

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState<string>("trigger");
  const [name, setName] = useState(automation.name);
  const [trigger, setTrigger] = useState(automation.trigger);
  const [savedTrigger, setSavedTrigger] = useState(automation.trigger);
  const [enabled, setEnabled] = useState(automation.enabled);
  const [toggling, setToggling] = useState(false);
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(automation.triggerConfig);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeRaw(changes.filter((c) => !(c.type === "remove" && "id" in c && c.id === "trigger")));
      if (changes.some((change) => change.type === "remove" || (change.type === "position" && change.dragging))) setDirty(true);
    },
    [onNodesChangeRaw]
  );

  const handleEdgesChange = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    onEdgesChange(changes);
    if (changes.some((change) => change.type === "remove")) setDirty(true);
  }, [onEdgesChange]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, id: crypto.randomUUID() }, eds));
      setDirty(true);
    },
    [setEdges]
  );

  function addPaletteItem(item: PaletteItem) {
    const current = nodes.find((node) => node.id === selectedId);
    const position = current
      ? { x: current.position.x + 290, y: current.position.y + (edges.some((edge) => edge.source === current.id) ? 155 : 0) }
      : { x: 320, y: 160 };
    const id = crypto.randomUUID();
    const data = defaultDataFor(item);
    setNodes((existing) => [...existing, { id, type: nodeTypeFor(data.kind), position, data: data as unknown as Record<string, unknown>, deletable: true }]);
    if (current) {
      const handle = current.data.kind === "condition" ? "true" : undefined;
      const outgoing = edges.find((edge) => edge.source === current.id && (handle === undefined || edge.sourceHandle === handle));
      if (outgoing) {
        setEdges((existing) => [
          ...existing.map((edge) => edge.id === outgoing.id ? { ...edge, target: id } : edge),
          { id: crypto.randomUUID(), source: id, target: outgoing.target },
        ]);
      } else {
        setEdges((existing) => [...existing, { id: crypto.randomUUID(), source: current.id, target: id, sourceHandle: handle }]);
      }
    }
    setSelectedId(id);
    setDirty(true);
  }

  const onDragStart = (e: DragEvent, item: PaletteItem) => {
    e.dataTransfer.setData("application/x-automation-item", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/x-automation-item");
      if (!raw) return;
      const item: PaletteItem = JSON.parse(raw);
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = crypto.randomUUID();
      const data = defaultDataFor(item);
      setNodes((nds) => [...nds, { id, type: nodeTypeFor(data.kind), position, data: data as unknown as Record<string, unknown>, deletable: true }]);
      setSelectedId(id);
      setDirty(true);
    },
    [screenToFlowPosition, setNodes]
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  function updateSelectedData(patch: Partial<NodeData> | Record<string, unknown>) {
    setNodes((nds) => nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)));
    setDirty(true);
  }

  function updateSelectedConfig(patch: Record<string, unknown>) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const data = n.data as unknown as Extract<NodeData, { kind: "action" }>;
        return { ...n, data: { ...data, config: { ...data.config, ...patch } } as unknown as Record<string, unknown> };
      })
    );
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const flowNodes = nodes.map((n) => ({ id: n.id, type: n.type!, position: n.position, data: n.data as unknown as NodeData }));
      const flowEdges = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle }));
      await saveFlow(automation.id, { nodes: flowNodes, edges: flowEdges }, trigger, triggerConfig);
      setSavedAt(new Date());
      setSavedTrigger(trigger);
      setDirty(false);
      setSaveError("");
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível salvar o fluxo");
    } finally {
      setSaving(false);
    }
  }

  function handleTriggerConfigChange(patch: Record<string, unknown>) {
    const next = { ...triggerConfig, ...patch };
    setTriggerConfig(next);
    setDirty(true);
  }

  function handleTriggerChange(next: string) {
    if (next === trigger || !Object.hasOwn(TRIGGER_LABEL, next)) return;
    setTrigger(next);
    setTriggerConfig({});
    setNodes((existing) => existing.map((node) => node.id === "trigger" ? { ...node, data: { kind: "trigger", label: next } } : node));
    setDirty(true);
  }

  async function handleToggle() {
    setToggling(true);
    try {
      await toggleAutomation(automation.id, !enabled);
      setEnabled(!enabled);
      setSaveError("");
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível alterar o status");
    } finally {
      setToggling(false);
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      <div className="automations-toolbar">
        <Link href="/automations" className="btn small ghost">← Voltar</Link>
        <input
          className="name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => renameAutomation(automation.id, name)}
        />
        <button className="pill automation-trigger-pill" onClick={() => setSelectedId("trigger")} title="Clique para trocar o gatilho">
          {TRIGGER_LABEL[trigger] ?? trigger} <span aria-hidden="true">▾</span>
        </button>
        <button className={`automation-status-toggle ${enabled ? "is-on" : ""}`} onClick={handleToggle} disabled={toggling} title={enabled ? "Pausar automação" : "Ativar automação"}>{enabled ? "Ativa" : "Pausada"}</button>
        <div style={{ flex: 1 }} />
        {dirty && <span className="automation-unsaved">Alterações não salvas</span>}
        {saveError && <span className="form-error" role="alert">{saveError}</span>}
        {savedAt && <span className="muted" style={{ fontSize: 12 }}>Salvo às {savedAt.toLocaleTimeString("pt-BR")}</span>}
        <button className="btn primary small" onClick={handleSave} disabled={saving}>
          {saving ? "Salvando..." : "Salvar fluxo"}
        </button>
      </div>

      <div className="automation-shell" style={{ flex: 1, minHeight: 0 }}>
        <div className="automation-palette">
          <h3>Adicione uma etapa</h3>
          <p className="automation-palette-help">Clique para inserir após o bloco selecionado (na saída “Sim” de condições) ou arraste para posicionar.</p>
          {PALETTE.map((item, i) => (
            <button key={i} type="button" className="palette-item" draggable onDragStart={(e) => onDragStart(e, item)} onClick={() => addPaletteItem(item)}>
              {item.kind === "action" && <Icon.plug />}
              {item.kind === "condition" && <Icon.settings />}
              {item.kind === "delay" && <Icon.up style={{ transform: "rotate(90deg)" }} />}
              {item.kind === "code" && <Icon.zap />}
              {item.label}
            </button>
          ))}
        </div>

        <div className="automation-canvas-wrap" ref={wrapperRef} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId("trigger")}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        <div className={`automation-inspector ${selectedNode?.data.kind === "code" ? "is-code" : ""}`}>
          {selectedId === "trigger" || !selectedNode ? (
            <TriggerInspector
              trigger={trigger}
              config={triggerConfig}
              pipelines={pipelines}
              team={team}
              webhookUrl={origin ? `${origin}${webhookPath}` : webhookPath}
              webhookReady={savedTrigger === "WEBHOOK_RECEIVED" && trigger === "WEBHOOK_RECEIVED" && enabled && edges.some((edge) => edge.source === "trigger")}
              webhookNotice={!enabled ? "Ative a automação para receber chamadas." : !edges.some((edge) => edge.source === "trigger") ? "Conecte o gatilho à primeira etapa e salve o fluxo." : "Salve o fluxo com este gatilho para ativar a URL."}
              onTriggerChange={handleTriggerChange}
              onChange={handleTriggerConfigChange}
            />
          ) : (
            <NodeInspector
              node={selectedNode}
              pipelines={pipelines}
              team={team}
              onChangeData={updateSelectedData}
              onChangeConfig={updateSelectedConfig}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TriggerInspector({
  trigger,
  config,
  pipelines,
  team,
  webhookUrl,
  webhookReady,
  webhookNotice,
  onTriggerChange,
  onChange,
}: {
  trigger: string;
  config: Record<string, unknown>;
  pipelines: PipelineDTO[];
  team: TeamMemberDTO[];
  webhookUrl: string;
  webhookReady: boolean;
  webhookNotice: string;
  onTriggerChange: (trigger: string) => void;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const selectedPipeline = pipelines.find((p) => p.id === config.pipelineId);
  const [copied, setCopied] = useState(false);

  return (
    <>
      <h3>Gatilho</h3>
      <div className="hint">O evento que inicia esta automação. Você pode trocá-lo a qualquer momento.</div>
      <div className="field">
        <label>Quando iniciar o fluxo</label>
        <select value={trigger} onChange={(event) => onTriggerChange(event.target.value)}>
          {Object.entries(TRIGGER_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <p className="field-help">Ao trocar o gatilho, as etapas conectadas continuam. Revise os campos usados por elas e clique em Salvar fluxo.</p>

      {trigger === "WEBHOOK_RECEIVED" && (
        <div className="automation-webhook-box">
          <strong>Webhook de entrada</strong>
          <p>Envie um POST com JSON para iniciar este fluxo. O conteúdo recebido vira <code>payload</code>.</p>
          {!webhookReady && <p className="automation-webhook-warning">{webhookNotice}</p>}
          <div className="field">
            <label>URL gerada para esta automação</label>
            <input readOnly value={webhookUrl} onFocus={(e) => e.target.select()} />
          </div>
          <button className="btn small" type="button" onClick={async () => { await navigator.clipboard.writeText(webhookUrl); setCopied(true); }} disabled={!webhookReady || !webhookUrl.startsWith("http")}>
            {copied ? "URL copiada" : "Copiar URL"}
          </button>
          <details className="automation-reference"><summary>Exemplo de envio</summary><pre>{`POST ${webhookUrl}\nContent-Type: application/json\n\n{"name":"Maria","email":"maria@empresa.com"}`}</pre></details>
          <p className="field-help">A URL contém um token de acesso. Compartilhe apenas com o sistema que vai enviar os dados.</p>
        </div>
      )}

      {trigger === "STAGE_CHANGED" && (
        <>
          <div className="field">
            <label>Pipeline (opcional)</label>
            <select
              value={String(config.pipelineId ?? "")}
              onChange={(e) => onChange({ pipelineId: e.target.value || undefined, stageId: undefined })}
            >
              <option value="">Qualquer pipeline</option>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {selectedPipeline && (
            <div className="field">
              <label>Etapa (opcional)</label>
              <select value={String(config.stageId ?? "")} onChange={(e) => onChange({ stageId: e.target.value || undefined })}>
                <option value="">Qualquer etapa</option>
                {selectedPipeline.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          )}
        </>
      )}

      {trigger === "TAG_ADDED" && (
        <div className="field">
          <label>Tag (opcional)</label>
          <input
            defaultValue={String(config.tag ?? "")}
            placeholder="Deixe vazio para qualquer tag"
            onBlur={(e) => onChange({ tag: e.target.value || undefined })}
          />
        </div>
      )}

      {trigger === "CONTACT_INACTIVE" && (
        <>
          <div className="field">
            <label>Sem interação por (dias)</label>
            <input
              type="number"
              min={1}
              max={3650}
              value={Number(config.inactivityDays ?? 3)}
              onChange={(e) => onChange({ inactivityDays: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <div className="field">
            <label>Repetir para o mesmo contato a cada (horas)</label>
            <input
              type="number"
              min={1}
              max={720}
              value={Number(config.repeatHours ?? 24)}
              onChange={(e) => onChange({ repeatHours: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>A inatividade é calculada pela última mensagem. A regra é verificada a cada minuto.</p>
        </>
      )}

      {trigger === "DATE_REACHED" && (
        <>
          <div className="field">
            <label>Executar em</label>
            <input
              type="datetime-local"
              value={typeof config.dateAt === "string" ? config.dateAt.slice(0, 16) : ""}
              onChange={(e) => onChange({ dateAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
            />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>A regra é disparada uma única vez, no primeiro ciclo após a data e hora escolhidas.</p>
        </>
      )}

      {trigger.startsWith("APPOINTMENT_") && (
        <div className="automation-appointment-box">
          <strong>Contexto do agendamento</strong>
          <p>O fluxo recebe o agendamento em <code>payload.appointment</code> e usa automaticamente o contato vinculado para enviar mensagem, criar tarefa ou atualizar o negócio.</p>
          {trigger === "APPOINTMENT_STARTING" && (
            <div className="field">
              <label>Disparar antes do início (minutos)</label>
              <input type="number" min={1} max={10080} value={Number(config.minutesBefore ?? 60)} onChange={(event) => onChange({ minutesBefore: Math.max(1, Number(event.target.value) || 1) })} />
              <div className="field-help">O sistema verifica a agenda a cada minuto e executa uma única vez por agendamento.</div>
            </div>
          )}
          <div className="field">
            <label>Responsável do agendamento (opcional)</label>
            <select value={String(config.ownerId ?? "")} onChange={(event) => onChange({ ownerId: event.target.value || undefined })}>
              <option value="">Qualquer responsável</option>
              {team.filter((member) => member.isActive).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Canal de origem (opcional)</label>
            <input defaultValue={String(config.bookingChannel ?? "")} placeholder="Ex.: WhatsApp, site, telefone" onBlur={(event) => onChange({ bookingChannel: event.target.value.trim() || undefined })} />
          </div>
          {trigger !== "APPOINTMENT_STARTING" && <p className="field-help">Este fluxo dispara quando o evento acontecer. Use “Agendamento vai começar” para lembretes antes do horário.</p>}
        </div>
      )}

      {(trigger === "CONTACT_CREATED" || trigger === "OPPORTUNITY_CREATED" || trigger === "MESSAGE_RECEIVED") && (
        <p className="muted" style={{ fontSize: 12 }}>Este gatilho não precisa de configuração extra.</p>
      )}

      <p className="muted" style={{ fontSize: 11, marginTop: 20 }}>
        Arraste uma ação da esquerda e conecte a partir deste nó pra começar o fluxo.
      </p>
    </>
  );
}

function NodeInspector({
  node,
  pipelines,
  team,
  onChangeData,
  onChangeConfig,
}: {
  node: Node;
  pipelines: PipelineDTO[];
  team: TeamMemberDTO[];
  onChangeData: (patch: Record<string, unknown>) => void;
  onChangeConfig: (patch: Record<string, unknown>) => void;
}) {
  const data = node.data as unknown as NodeData;
  const allStages = pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipelineName: p.name })));

  if (data.kind === "action") {
    const config = data.config as Record<string, string | number | undefined>;
    return (
      <>
        <h3>{ACTION_LABEL[data.actionType]}</h3>
        <div className="hint">Configure esta ação</div>

        {data.actionType === "send_message" && (
          <div className="field">
            <label>Mensagem</label>
            <textarea defaultValue={String(config.text ?? "")} onBlur={(e) => onChangeConfig({ text: e.target.value })} rows={4} />
          </div>
        )}

        {data.actionType === "create_task" && (
          <>
            <div className="field">
              <label>Título da tarefa</label>
              <input defaultValue={String(config.title ?? "")} onBlur={(e) => onChangeConfig({ title: e.target.value })} />
            </div>
            <div className="field">
              <label>Vencimento (dias a partir de agora)</label>
              <input type="number" min={0} defaultValue={Number(config.dueInDays ?? 1)} onBlur={(e) => onChangeConfig({ dueInDays: Number(e.target.value) })} />
            </div>
          </>
        )}

        {data.actionType === "move_stage" && (
          <div className="field">
            <label>Nova etapa</label>
            <select value={String(config.stageId ?? "")} onChange={(e) => onChangeConfig({ stageId: e.target.value })}>
              <option value="">Selecione...</option>
              {allStages.map((s) => <option key={s.id} value={s.id}>{s.pipelineName} · {s.label}</option>)}
            </select>
          </div>
        )}

        {data.actionType === "add_tag" && (
          <>
            <div className="field">
              <label>Tag</label>
              <input defaultValue={String(config.tag ?? "")} onBlur={(e) => onChangeConfig({ tag: e.target.value })} />
            </div>
            <div className="field">
              <label>Em</label>
              <select value={String(config.target ?? "contact")} onChange={(e) => onChangeConfig({ target: e.target.value })}>
                <option value="contact">Contato</option>
                <option value="opportunity">Oportunidade</option>
              </select>
            </div>
          </>
        )}

        {data.actionType === "assign_owner" && (
          <>
            <div className="field">
              <label>Responsável</label>
              <select value={String(config.ownerId ?? "")} onChange={(e) => onChangeConfig({ ownerId: e.target.value })}>
                <option value="">Sem responsável</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Em</label>
              <select value={String(config.target ?? "contact")} onChange={(e) => onChangeConfig({ target: e.target.value })}>
                <option value="contact">Contato</option>
                <option value="opportunity">Oportunidade</option>
              </select>
            </div>
          </>
        )}

        {data.actionType === "webhook" && (
          <>
            <div className="field">
              <label>URL de destino (POST)</label>
              <input defaultValue={String(config.url ?? "")} onBlur={(e) => onChangeConfig({ url: e.target.value })} placeholder="https://..." />
            </div>
            <p className="field-help">Esta etapa envia dados para outro sistema. Para receber dados e iniciar o fluxo, selecione “Webhook recebido” no gatilho.</p>
          </>
        )}

        {data.actionType === "create_contact" && (
          <>
            <p className="field-help">Cria um novo contato. Use campos do webhook como <code>{"{{payload.name}}"}</code>. O contato criado fica disponível para as próximas etapas.</p>
            {(["name", "email", "phone", "company"] as const).map((field) => (
              <div className="field" key={field}>
                <label>{({ name: "Nome *", email: "E-mail", phone: "Telefone", company: "Empresa" })[field]}</label>
                <input value={String(config[field] ?? "")} onChange={(e) => onChangeConfig({ [field]: e.target.value })} placeholder={field === "name" ? "{{payload.name}}" : `{{payload.${field}}}`} />
              </div>
            ))}
          </>
        )}

        {data.actionType === "create_opportunity" && (
          <>
            <p className="field-help">Precisa de um contato no contexto: informe <code>contactId</code> no webhook ou conecte antes uma etapa “Criar contato”.</p>
            <div className="field"><label>Título *</label><input value={String(config.title ?? "")} onChange={(e) => onChangeConfig({ title: e.target.value })} /></div>
            <div className="field">
              <label>Pipeline *</label>
              <select value={String(config.pipelineId ?? "")} onChange={(e) => onChangeConfig({ pipelineId: e.target.value, stageId: "" })}>
                <option value="">Selecione...</option>
                {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Etapa inicial *</label>
              <select value={String(config.stageId ?? "")} onChange={(e) => onChangeConfig({ stageId: e.target.value })}>
                <option value="">Selecione...</option>
                {pipelines.find((pipeline) => pipeline.id === config.pipelineId)?.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Valor (R$)</label><input type="number" min={0} step="0.01" value={Number(config.value ?? 0)} onChange={(e) => onChangeConfig({ value: Number(e.target.value) })} /></div>
          </>
        )}
      </>
    );
  }

  if (data.kind === "condition") {
    return (
      <>
        <h3>Condição</h3>
        <div className="hint">Se verdadeiro segue por &quot;Sim&quot;, senão por &quot;Não&quot;</div>
        <div className="field">
          <label>Campo</label>
          <select value={data.field} onChange={(e) => onChangeData({ field: e.target.value, operator: "equals" })}>
            <option value="contact_tag">Tag do contato</option>
            <option value="contact_name">Nome do contato</option>
            <option value="contact_email">E-mail do contato</option>
            <option value="contact_phone">Telefone do contato</option>
            <option value="contact_company">Empresa do contato</option>
            <option value="opportunity_value">Valor da oportunidade</option>
            <option value="stage_label">Nome da etapa atual</option>
            <option value="payload_field">Campo do webhook</option>
          </select>
        </div>
        {data.field === "payload_field" && <div className="field"><label>Caminho no JSON recebido</label><input value={data.path ?? ""} onChange={(e) => onChangeData({ path: e.target.value })} placeholder="cliente.email" /><span className="field-help">Exemplo: <code>cliente.email</code> lê <code>{'{"cliente":{"email":"..."}}'}</code>.</span></div>}
        <div className="field">
          <label>Operador</label>
          <select value={data.operator} onChange={(e) => onChangeData({ operator: e.target.value })}>
            {data.field === "opportunity_value" ? (
              <>
                <option value="equals">é igual a</option>
                <option value="gt">é maior que</option>
                <option value="lt">é menor que</option>
              </>
            ) : data.field === "contact_tag" || data.field === "stage_label" ? (
              <>
                <option value="equals">é igual a</option>
                <option value="not_equals">é diferente de</option>
              </>
            ) : (
              <>
                <option value="equals">é igual a</option>
                <option value="not_equals">é diferente de</option>
                <option value="contains">contém</option>
                <option value="not_contains">não contém</option>
                <option value="exists">está preenchido</option>
              </>
            )}
          </select>
        </div>
        {data.operator !== "exists" && <div className="field">
          <label>Valor</label>
          <input value={data.value} onChange={(e) => onChangeData({ value: e.target.value })} />
        </div>}
      </>
    );
  }

  if (data.kind === "code") {
    return <CodeInspector code={data.code} onChange={(code) => onChangeData({ code })} />;
  }

  if (data.kind === "delay") {
    return (
      <>
        <h3>Espera</h3>
        <div className="hint">Pausa o fluxo antes de continuar</div>
        <div className="field-row">
          <div className="field">
            <label>Quantidade</label>
            <input type="number" min={1} defaultValue={data.amount} onBlur={(e) => onChangeData({ amount: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Unidade</label>
            <select value={data.unit} onChange={(e) => onChangeData({ unit: e.target.value })}>
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
              <option value="days">Dias</option>
            </select>
          </div>
        </div>
      </>
    );
  }

  return null;
}

function CodeInspector({ code, onChange }: { code: string; onChange: (code: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const editor = (large: boolean) => (
    <textarea
      className={`code-textarea ${large ? "is-expanded" : ""}`}
      aria-label="Código JavaScript da automação"
      value={code}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
      placeholder={'crm.log("Fluxo iniciado", payload);'}
    />
  );

  return (
    <>
      <h3>Código JS</h3>
      <div className="hint">Etapa avançada: executa JavaScript no servidor quando o fluxo chega aqui.</div>
      <div className="automation-code-intro"><strong>O que são as funções <code>crm.*</code>?</strong><p>São funções prontas do próprio CRM para consultar dados ou realizar ações. Use <code>await</code> quando chamar uma delas. <code>payload</code> contém os dados do evento; <code>contact</code>, <code>opportunity</code> e <code>appointment</code> representam os registros vinculados à execução.</p></div>
      <div className="automation-code-tools">
        <button type="button" className="btn small" onClick={() => setExpanded(true)}>Abrir editor ampliado</button>
      </div>
      <div className="field">{editor(false)}</div>
      <details className="automation-reference">
        <summary>Ver funções e exemplos do CRM</summary>
        <p>Comunicação e tarefas</p>
        <code>{'await crm.sendMessage("Olá!")'}</code>
        <code>{'await crm.createTask("Retornar ligação", { dueInDays: 1 })'}</code>
        <p>Contatos e negócios</p>
        <code>{'await crm.addTag("Qualificado", "contact")'}</code>
        <code>{'await crm.createContact({ name: "Maria" })'}</code>
        <code>await crm.getContact(contact.id)</code>
        <code>{'await crm.listContacts("Maria")'}</code>
        <code>await crm.listOpportunities()</code>
        <code>await crm.listPipelines()</code>
        <code>await crm.listTeam()</code>
        <code>{'await crm.moveOpportunityStage(opportunity.id, "id-da-etapa")'}</code>
        <code>{'await crm.createOpportunity({ title: "Proposta", contactId: contact.id, pipelineId: "...", stageId: "..." })'}</code>
        <p>Diagnóstico</p>
        <code>{'crm.log("Dados recebidos", payload)'}</code>
        <span>O log aparece no histórico de execuções da automação.</span>
      </details>
      <p className="field-help">O código não precisa de <code>import</code>. Salve o fluxo depois de editar. Use apenas código confiável: esta etapa roda no servidor.</p>
      {expanded && (
        <div className="modal-overlay automation-code-overlay" onClick={() => setExpanded(false)}>
          <div className="automation-code-dialog" role="dialog" aria-modal="true" aria-label="Editor de código JavaScript" onClick={(event) => event.stopPropagation()}>
            <div className="automation-code-dialog-head"><div><h2>Código JS</h2><p>Use <code>payload</code>, <code>contact</code>, <code>opportunity</code>, <code>appointment</code> e as funções <code>crm.*</code>.</p></div><button className="btn small" onClick={() => setExpanded(false)}>Concluir edição</button></div>
            {editor(true)}
            <div className="automation-code-dialog-foot">As alterações ficam no editor até você clicar em “Salvar fluxo”.</div>
          </div>
        </div>
      )}
    </>
  );
}
