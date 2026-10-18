"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { createTagAction, deleteTagAction, updateTagAction, type TagInput } from "@/app/tags/actions";

type Tag = { id: string; name: string; color: string; description: string; appliesToContacts: boolean; appliesToOpportunities: boolean; contacts: number; opportunities: number };

export function TagsView({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<"new" | Tag | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(tag: Tag) {
    if (!confirm(`Excluir a tag “${tag.name}”? Ela será removida dos ${tag.contacts} contato(s) e ${tag.opportunities} negócio(s) vinculados.`)) return;
    setBusy(true);
    try {
      const result = await deleteTagAction(tag.id);
      if (result.error) alert(result.error);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Tags</h1>
          <div className="sub">Classifique leads e negócios com as mesmas etiquetas em todo o CRM</div>
        </div>
        <button className="btn primary" onClick={() => setModal("new")}><Icon.plus /> Nova tag</button>
      </div>
      <div className="content">
        <section className="tags-intro">
          <div><span className="eyebrow">CATÁLOGO CENTRAL</span><h2>Defina onde cada tag pode ser usada</h2><p>Ao criar uma tag, escolha <b>Leads</b>, <b>Negócios</b> ou <b>Ambos</b>. O catálogo é único, mas o escopo deixa claro onde cada etiqueta aparece.</p></div>
        </section>
        {tags.length === 0 ? (
          <div className="empty-state"><Icon.empty /><div>Nenhuma tag cadastrada. Crie a primeira para organizar leads e negócios.</div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tag</th><th>Disponível em</th><th>Uso em leads</th><th>Uso em negócios</th><th /></tr></thead>
              <tbody>
                {tags.map((tag) => (
                  <tr className="row" key={tag.id}>
                    <td><span className="tag tag-config" style={{ background: `${tag.color}18`, color: tag.color }}><i style={{ background: tag.color }} />{tag.name}</span>{tag.description && <small className="tag-description">{tag.description}</small>}</td>
                    <td><span className="tag-scope">{tag.appliesToContacts && tag.appliesToOpportunities ? "Leads e negócios" : tag.appliesToContacts ? "Leads" : "Negócios"}</span></td>
                    <td>{tag.contacts} contato{tag.contacts === 1 ? "" : "s"}</td>
                    <td>{tag.opportunities} oportunidade{tag.opportunities === 1 ? "" : "s"}</td>
                    <td style={{ textAlign: "right" }}><button className="btn small" onClick={() => setModal(tag)}>Editar</button>{" "}<button className="btn small danger" disabled={busy} onClick={() => remove(tag)}><Icon.trash /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal && <TagModal tag={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); router.refresh(); }} />}
    </>
  );
}

function TagModal({ tag, onClose, onSaved }: { tag: Tag | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? "#4f46e5");
  const [description, setDescription] = useState(tag?.description ?? "");
  const [appliesToContacts, setAppliesToContacts] = useState(tag?.appliesToContacts ?? true);
  const [appliesToOpportunities, setAppliesToOpportunities] = useState(tag?.appliesToOpportunities ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const input: TagInput = { name, color, description, appliesToContacts, appliesToOpportunities };
      const result = tag ? await updateTagAction(tag.id, input) : await createTagAction(input);
      if (result.error) { setError(result.error); return; }
      onSaved();
    } finally { setBusy(false); }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>{tag ? "Editar tag" : "Nova tag"}</h2><button className="close-x" onClick={onClose}><Icon.close /></button></div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field"><label>Nome *</label><input required autoFocus maxLength={50} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: VIP, Indicação, Urgente" /></div>
            <div className="field"><label>Descrição</label><input maxLength={180} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: prioridade comercial e atendimento dedicado" /></div>
            <div className="field"><label>Onde esta tag pode ser usada *</label><div className="tag-scope-picker"><label><input type="checkbox" checked={appliesToContacts} onChange={(event) => setAppliesToContacts(event.target.checked)} /> Leads / contatos</label><label><input type="checkbox" checked={appliesToOpportunities} onChange={(event) => setAppliesToOpportunities(event.target.checked)} /> Negócios / oportunidades</label></div>{!appliesToContacts && !appliesToOpportunities && <p className="form-error">Selecione ao menos um destino.</p>}</div>
            <div className="field"><label>Cor</label><div className="tag-color-input"><input aria-label="Cor da tag" type="color" value={color} onChange={(event) => setColor(event.target.value)} /><span className="tag tag-config" style={{ background: `${color}18`, color }}><i style={{ background: color }} />{name || "Prévia da tag"}</span></div></div>
            {error && <p className="form-error">{error}</p>}
          </div>
          <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Salvando..." : "Salvar tag"}</button></div>
        </form>
      </div>
    </div>
  );
}
