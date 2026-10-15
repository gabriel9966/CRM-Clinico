"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import type { CustomFieldDefinitionDTO } from "@/lib/types";
import { createCustomField, deleteCustomField, type CustomFieldInput } from "@/app/custom-fields/actions";

const TYPE_LABEL: Record<CustomFieldDefinitionDTO["type"], string> = {
  TEXT: "Texto",
  NUMBER: "Número",
  DATE: "Data",
  BOOLEAN: "Sim/Não",
  SELECT: "Lista de opções",
};

export function CustomFieldsView({ fields }: { fields: CustomFieldDefinitionDTO[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"CONTACT" | "OPPORTUNITY">("CONTACT");
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const list = fields.filter((f) => f.entity === tab);

  async function handleDelete(id: string) {
    if (!confirm("Excluir este campo? Os valores já preenchidos ficarão ocultos (mas não são apagados dos registros).")) return;
    setBusy(true);
    try {
      await deleteCustomField(id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Campos personalizados</h1>
          <div className="sub">Adicione informações extras em Contatos e Oportunidades</div>
        </div>
        <button className="btn primary" onClick={() => setModalOpen(true)}>
          <Icon.plus /> Novo campo
        </button>
      </div>

      <div className="content">
        <div className="tabs">
          <button className={`tab ${tab === "CONTACT" ? "active" : ""}`} onClick={() => setTab("CONTACT")}>
            Contatos
          </button>
          <button className={`tab ${tab === "OPPORTUNITY" ? "active" : ""}`} onClick={() => setTab("OPPORTUNITY")}>
            Oportunidades
          </button>
        </div>

        {list.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            <Icon.empty />
            <div>Nenhum campo personalizado em {tab === "CONTACT" ? "Contatos" : "Oportunidades"} ainda.</div>
          </div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr><th>Nome</th><th>Tipo</th><th>Opções</th><th></th></tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id} className="row" style={{ cursor: "default" }}>
                    <td style={{ fontWeight: 700 }}>{f.label}</td>
                    <td>{TYPE_LABEL[f.type]}</td>
                    <td className="muted">{f.type === "SELECT" ? f.options.join(", ") : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn small danger" disabled={busy} onClick={() => handleDelete(f.id)}>
                        <Icon.trash /> Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <NewFieldModal
          defaultEntity={tab}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function NewFieldModal({
  defaultEntity,
  onClose,
  onSaved,
}: {
  defaultEntity: "CONTACT" | "OPPORTUNITY";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [entity, setEntity] = useState(defaultEntity);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldInput["type"]>("TEXT");
  const [optionsText, setOptionsText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError("");
    try {
      const res = await createCustomField({
        entity,
        label,
        type,
        options: optionsText.split(",").map((o) => o.trim()).filter(Boolean),
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Novo campo personalizado</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="modal-body">
            <div className="field">
              <label>Onde aparece *</label>
              <select value={entity} onChange={(e) => setEntity(e.target.value as "CONTACT" | "OPPORTUNITY")}>
                <option value="CONTACT">Contato</option>
                <option value="OPPORTUNITY">Oportunidade</option>
              </select>
            </div>
            <div className="field">
              <label>Nome do campo *</label>
              <input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: CNPJ, Origem do lead" autoFocus />
            </div>
            <div className="field">
              <label>Tipo *</label>
              <select value={type} onChange={(e) => setType(e.target.value as CustomFieldInput["type"])}>
                <option value="TEXT">Texto</option>
                <option value="NUMBER">Número</option>
                <option value="DATE">Data</option>
                <option value="BOOLEAN">Sim/Não</option>
                <option value="SELECT">Lista de opções</option>
              </select>
            </div>
            {type === "SELECT" && (
              <div className="field">
                <label>Opções (separadas por vírgula) *</label>
                <input
                  required
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder="Ex: Indicação, Site, Evento"
                />
              </div>
            )}
            {error && <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600 }}>{error}</p>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={pending}>
              {pending ? "Criando..." : "Criar campo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
