"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Icon } from "@/components/icons";
import { ACTION_LABEL, TRIGGER_LABEL, type NodeData } from "@/lib/automation/types";

type FlowNodeProps = NodeProps & { data: NodeData };

export function TriggerNode({ data, selected }: FlowNodeProps) {
  if (data.kind !== "trigger") return null;
  return (
    <div className={`flow-node trigger ${selected ? "selected" : ""}`}>
      <div className="flow-node-head"><Icon.zap /> Gatilho</div>
      <div className="flow-node-body">{TRIGGER_LABEL[data.label] ?? data.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ActionNode({ data, selected }: FlowNodeProps) {
  if (data.kind !== "action") return null;
  return (
    <div className={`flow-node action ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-head"><Icon.plug /> Ação</div>
      <div className="flow-node-body">{ACTION_LABEL[data.actionType]}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ConditionNode({ data, selected }: FlowNodeProps) {
  if (data.kind !== "condition") return null;
  return (
    <div className={`flow-node condition ${selected ? "selected" : ""}`} style={{ position: "relative" }}>
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-head"><Icon.settings /> Condição</div>
      <div className="flow-node-body">
        {data.field || "campo"} {data.operator || "="} {data.value || "?"}
      </div>
      <Handle type="source" position={Position.Right} id="true" style={{ top: "35%" }} />
      <span className="flow-node-handle-label" style={{ right: -34, top: "28%" }}>Sim</span>
      <Handle type="source" position={Position.Right} id="false" style={{ top: "75%" }} />
      <span className="flow-node-handle-label" style={{ right: -40, top: "68%" }}>Não</span>
    </div>
  );
}

export function CodeNode({ data, selected }: FlowNodeProps) {
  if (data.kind !== "code") return null;
  const preview = data.code.trim().split("\n")[0]?.slice(0, 40) || "// código vazio";
  return (
    <div className={`flow-node code ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-head"><Icon.plug /> Código JS</div>
      <div className="flow-node-body" style={{ fontFamily: "monospace" }}>{preview}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function DelayNode({ data, selected }: FlowNodeProps) {
  if (data.kind !== "delay") return null;
  const unitLabel = data.unit === "minutes" ? "min" : data.unit === "hours" ? "h" : "dias";
  return (
    <div className={`flow-node delay ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-head"><Icon.up style={{ transform: "rotate(90deg)" }} /> Espera</div>
      <div className="flow-node-body">{data.amount} {unitLabel}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const NODE_TYPES = {
  triggerNode: TriggerNode,
  actionNode: ActionNode,
  conditionNode: ConditionNode,
  delayNode: DelayNode,
  codeNode: CodeNode,
};
