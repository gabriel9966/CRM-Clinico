"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
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
import { renameAutomation, updateTriggerConfig, saveFlow } from "@/app/automations/actions";

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
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(automation.triggerConfig);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeRaw(changes.filter((c) => !(c.type === "remove" && "id" in c && c.id === "trigger")));
    },
    [onNodesChangeRaw]
  );

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, id: crypto.randomUUID() }, eds)),
    [setEdges]
  );

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
    },
    [screenToFlowPosition, setNodes]
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  function updateSelectedData(patch: Partial<NodeData> | Record<string, unknown>) {
    setNodes((nds) => nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)));
  }

  function updateSelectedConfig(patch: Record<string, unknown>) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const data = n.data as unknown as Extract<NodeData, { kind: "action" }>;
        return { ...n, data: { ...data, config: { ...data.config, ...patch } } as unknown as Record<string, unknown> };
      })
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const flowNodes = nodes.map((n) => ({ id: n.id, type: n.type!, position: n.position, data: n.data as unknown as NodeData }));
      const flowEdges = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle }));
      await saveFlow(automation.id, { nodes: flowNodes, edges: flowEdges });
      setSavedAt(new Date());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleTriggerConfigChange(patch: Record<string, unknown>) {
    const next = { ...triggerConfig, ...patch };
    setTriggerConfig(next);
    await updateTriggerConfig(automation.id, next);
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
        <span className="pill" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
          {TRIGGER_LABEL[automation.trigger] ?? automation.trigger}
        </span>
        <div style={{ flex: 1 }} />
        {savedAt && <span className="muted" style={{ fontSize: 12 }}>Salvo às {savedAt.toLocaleTimeString("pt-BR")}</span>}
        <button className="btn primary small" onClick={handleSave} disabled={saving}>
          {saving ? "Salvando..." : "Salvar fluxo"}
        </button>
      </div>

      <div className="automation-shell" style={{ flex: 1, minHeight: 0 }}>
        <div className="automation-palette">
          <h3>Arraste para o canvas</h3>
          {PALETTE.map((item, i) => (
            <div key={i} className="palette-item" draggable onDragStart={(e) => onDragStart(e, item)}>
              {item.kind === "action" && <Icon.plug />}
              {item.kind === "condition" && <Icon.settings />}
              {item.kind === "delay" && <Icon.up style={{ transform: "rotate(90deg)" }} />}
              {item.kind === "code" && <Icon.zap />}
              {item.label}
            </div>
          ))}
        </div>

        <div className="automation-canvas-wrap" ref={wrapperRef} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
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

        <div className="automation-inspector">
          {selectedId === "trigger" || !selectedNode ? (
            <TriggerInspector
              trigger={automation.trigger}
              config={triggerConfig}
              pipelines={pipelines}
              webhookPath={webhookPath}
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
  webhookPath,
  onChange,
}: {
  trigger: string;
  config: Record<string, unknown>;
  pipelines: PipelineDTO[];
  webhookPath: string;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const selectedPipeline = pipelines.find((p) => p.id === config.pipelineId);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}${webhookPath}`);
  }, [webhookPath]);

  return (
    <>
      <h3>Gatilho</h3>
      <div className="hint">{TRIGGER_LABEL[trigger] ?? trigger}</div>

      {trigger === "WEBHOOK_RECEIVED" && (
        <>
          <div className="field">
            <label>URL do webhook (POST)</label>
            <input readOnly value={webhookUrl} onFocus={(e) => e.target.select()} />
          </div>
          <p className="muted" style={{ fontSize: 11 }}>
            Qualquer sistema externo (n8n, um formulário, etc.) pode enviar um POST com JSON pra essa URL. O corpo
            fica disponível como <code>payload</code> no nó de Código.
          </p>
        </>
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
          <div className="field">
            <label>URL</label>
            <input defaultValue={String(config.url ?? "")} onBlur={(e) => onChangeConfig({ url: e.target.value })} placeholder="https://..." />
          </div>
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
          <select value={data.field} onChange={(e) => onChangeData({ field: e.target.value })}>
            <option value="contact_tag">Tag do contato</option>
            <option value="opportunity_value">Valor da oportunidade</option>
            <option value="stage_label">Nome da etapa atual</option>
          </select>
        </div>
        <div className="field">
          <label>Operador</label>
          <select value={data.operator} onChange={(e) => onChangeData({ operator: e.target.value })}>
            {data.field === "opportunity_value" ? (
              <>
                <option value="equals">é igual a</option>
                <option value="gt">é maior que</option>
                <option value="lt">é menor que</option>
              </>
            ) : (
              <>
                <option value="equals">é igual a / contém</option>
                <option value="not_equals">é diferente de / não contém</option>
              </>
            )}
          </select>
        </div>
        <div className="field">
          <label>Valor</label>
          <input defaultValue={data.value} onBlur={(e) => onChangeData({ value: e.target.value })} />
        </div>
      </>
    );
  }

  if (data.kind === "code") {
    return (
      <>
        <h3>Código JS</h3>
        <div className="hint">Roda no servidor quando o fluxo chega aqui</div>
        <div className="code-hint">
          Disponíveis: <code>payload</code>, <code>contact</code>, <code>opportunity</code> e:
          <br /><code>crm.sendMessage(texto, contactId?)</code>
          <br /><code>crm.addTag(tag, &quot;contact&quot;|&quot;opportunity&quot;, id?)</code>
          <br /><code>crm.createTask(titulo, {`{dueInDays, notes}`})</code>
          <br /><code>crm.moveOpportunityStage(oppId, stageId)</code>
          <br /><code>crm.createContact(dados)</code> · <code>crm.getContact(id)</code>
          <br /><code>crm.listContacts(busca?)</code> · <code>crm.listOpportunities(filtro?)</code>
          <br /><code>crm.listPipelines()</code> · <code>crm.listTeam()</code>
          <br /><code>crm.log(...)</code> — aparece no histórico de execução
        </div>
        <div className="field">
          <textarea
            className="code-textarea"
            defaultValue={data.code}
            onBlur={(e) => onChangeData({ code: e.target.value })}
            spellCheck={false}
          />
        </div>
      </>
    );
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
