"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { colorFor, initials, fmtMoney, fmtDate, fmtTime } from "@/lib/format";
import type {
  ContactDTO,
  ContactRowDTO,
  OpportunityDTO,
  MessageDTO,
  ActivityDTO,
  TeamMemberDTO,
  PipelineDTO,
  CustomFieldDefinitionDTO,
  DuplicateContactGroupDTO,
  SegmentDTO,
  Page,
} from "@/lib/types";
import { createContact, updateContact, deleteContact, importContactsCsv, mergeContacts, bulkUpdateContacts, type ContactInput } from "@/app/contacts/actions";
import { createSegment, deleteSegment } from "@/app/segments/actions";
import { fetchContactsPage, fetchContactDetail, fetchDuplicateGroups } from "@/app/listings/actions";
import { CustomFieldInputs, readCustomFieldValues } from "@/components/shared/CustomFieldInputs";
import { ImportCsvModal } from "@/components/shared/ImportCsvModal";

type Modal =
  | { type: "form"; data: ContactDTO | null }
  | { type: "detail"; contactId: string }
  | { type: "import" }
  | { type: "duplicates" }
  | { type: "segments" };

type Detail = {
  contact: ContactDTO;
  opportunities: OpportunityDTO[];
  messages: MessageDTO[];
  activities: ActivityDTO[];
  conversationHidden: boolean;
};

const SEARCH_DEBOUNCE_MS = 300;

export function ContactsView({
  initialPage,
  initialQuery,
  initialContactId,
  duplicateCount,
  team,
  pipelines,
  customFieldDefs,
  segments,
}: {
  initialPage: Page<ContactRowDTO>;
  initialQuery: string;
  initialContactId: string | null;
  duplicateCount: number;
  team: TeamMemberDTO[];
  pipelines: PipelineDTO[];
  customFieldDefs: CustomFieldDefinitionDTO[];
  segments: SegmentDTO[];
}) {
  const router = useRouter();

  // A lista vem paginada do servidor: a página inicial chega pronta e o resto
  // é buscado sob demanda ("Carregar mais", busca, lista salva).
  const [rows, setRows] = useState<ContactRowDTO[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [total, setTotal] = useState<number>(initialPage.total ?? initialPage.items.length);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Chegando da busca global (/contacts?q=...&contact=<id>): o servidor já
  // aplicou o filtro e aqui só abrimos o detalhe do contato encontrado.
  const [search, setSearch] = useState(initialQuery);
  const [modal, setModal] = useState<Modal | null>(() =>
    initialContactId ? { type: "detail", contactId: initialContactId } : null
  );
  const [detail, setDetail] = useState<Detail | null | "missing">(null);
  const [detailTab, setDetailTab] = useState<"perfil" | "negocios" | "conversa" | "atividade">("perfil");
  const [busy, setBusy] = useState(false);
  const [activeSegment, setActiveSegment] = useState<{ id: string; name: string } | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateContactGroupDTO[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const requestId = useRef(0);
  const firstRun = useRef(true);

  // Recarrega a primeira página quando a busca, a lista salva ou os dados mudam.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const mine = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const page = await fetchContactsPage({ q: search.trim() || undefined, segmentId: activeSegment?.id });
        if (mine !== requestId.current) return; // chegou uma busca mais nova
        setRows(page.items);
        setNextCursor(page.nextCursor);
        setTotal(page.total ?? page.items.length);
      } catch {
        if (mine === requestId.current) setLoadError("Não foi possível carregar os contatos. Tente de novo.");
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, activeSegment?.id, reloadKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const mine = requestId.current;
    setLoadingMore(true);
    try {
      const page = await fetchContactsPage({ q: search.trim() || undefined, segmentId: activeSegment?.id, cursor: nextCursor });
      if (mine !== requestId.current) return;
      setRows((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setLoadError("Não foi possível carregar mais contatos.");
    } finally {
      setLoadingMore(false);
    }
  }

  // Detalhe (negócios + conversa) só é buscado ao abrir o contato.
  const detailId = modal?.type === "detail" ? modal.contactId : null;
  useEffect(() => {
    if (!detailId) return;
    let cancelled = false;
    fetchContactDetail(detailId)
      .then((d) => {
        if (!cancelled) setDetail(d ?? "missing");
      })
      .catch(() => {
        if (!cancelled) setDetail("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  // Abrir um contato limpa o detalhe anterior (feito aqui, no clique, e não
  // dentro do efeito) para não piscar os dados do contato visto antes.
  function openDetail(contactId: string) {
    setDetail(null);
    setDetailTab("perfil");
    setModal({ type: "detail", contactId });
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      setReloadKey((k) => k + 1);
      router.refresh(); // atualiza contagem de duplicados e listas salvas
    } finally {
      setBusy(false);
    }
  }

  async function openDuplicates() {
    setModal({ type: "duplicates" });
    setDuplicates(null);
    setDuplicates(await fetchDuplicateGroups());
  }

  async function submitContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (modal?.type !== "form") return;
    const fd = new FormData(e.currentTarget);
    const tags = String(fd.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean);
    const payload: ContactInput = {
      name: String(fd.get("name") || ""),
      company: String(fd.get("company") || ""),
      email: String(fd.get("email") || ""),
      phone: String(fd.get("phone") || ""),
      tags,
      notes: String(fd.get("notes") || ""),
      source: String(fd.get("source") || ""),
      score: Number(fd.get("score") || 0),
      ownerId: (String(fd.get("ownerId") || "") || null),
      customFields: readCustomFieldValues(fd, customFieldDefs, "CONTACT"),
    };
    const existing = modal.data;
    await run(async () => {
      if (existing) await updateContact(existing.id, payload);
      else await createContact(payload);
    });
    setModal(null);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Contatos</h1>
          <div className="sub">
            Todas as pessoas e empresas no seu radar · {total.toLocaleString("pt-BR")} {total === 1 ? "contato" : "contatos"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn" href="/api/export/contacts"><Icon.download /> Exportar CSV</a>
          <button className="btn" onClick={() => setModal({ type: "import" })}><Icon.upload /> Importar CSV</button>
          {duplicateCount > 0 && (
            <button className="btn" onClick={openDuplicates}>
              Duplicados ({duplicateCount >= 50 ? "50+" : duplicateCount})
            </button>
          )}
          <button className="btn" onClick={() => setModal({ type: "segments" })}>Segmentos</button>
          <button className="btn primary" onClick={() => setModal({ type: "form", data: null })}>
            <Icon.plus /> Novo contato
          </button>
        </div>
      </div>

      <div className="content">
        <div className="search-bar">
          <Icon.search />
          <input
            placeholder="Buscar por nome, empresa, e-mail ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {activeSegment && (
          <div className="legend-row" style={{ marginTop: -8, marginBottom: 14 }}>
            <span className="tag">Lista: {activeSegment.name}</span>
            <button className="btn small ghost" onClick={() => setActiveSegment(null)}>Limpar filtro</button>
          </div>
        )}
        {loadError && (
          <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{loadError}</p>
        )}
        {selected.length > 0 && <div className="legend-row" style={{ marginBottom: 10, gap: 8 }}><strong>{selected.length} selecionado(s)</strong><button className="btn small" onClick={() => { const tag = prompt("Tag para adicionar:"); if (tag?.trim()) run(() => bulkUpdateContacts(selected, { addTags: [tag.trim()] })).then(() => setSelected([])); }}>Adicionar tag</button><select defaultValue="" onChange={(e) => { if (e.target.value) run(() => bulkUpdateContacts(selected, { ownerId: e.target.value === "__none" ? null : e.target.value })).then(() => setSelected([])); }}><option value="">Atribuir responsável</option><option value="__none">Sem responsável</option>{team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button className="btn small danger" onClick={() => { if (confirm("Mover os contatos selecionados para a lixeira?")) run(() => bulkUpdateContacts(selected, { delete: true })).then(() => setSelected([])); }}>Excluir</button><button className="btn small" onClick={() => setSelected([])}>Limpar</button></div>}

        <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={rows.length > 0 && selected.length === rows.length} onChange={(e) => setSelected(e.target.checked ? rows.map((row) => row.id) : [])} /></th><th>Nome</th><th>Empresa</th><th>Origem</th><th>Score</th><th>E-mail</th><th>Telefone</th><th>Tags</th><th>Responsável</th><th>Negócios</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10}><div className="empty-state"><Icon.empty /><div>{loading ? "Buscando…" : "Nenhum contato encontrado"}</div></div></td></tr>
              ) : (
                rows.map((c) => {
                  const owner = team.find((m) => m.id === c.ownerId);
                  return (
                    <tr
                      key={c.id}
                      className="row"
                      onClick={() => openDetail(c.id)}
                    >
                      <td><input type="checkbox" checked={selected.includes(c.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSelected((current) => e.target.checked ? [...current, c.id] : current.filter((id) => id !== c.id))} /></td>
                      <td>
                        <div className="name-cell">
                          <span className="avatar md" style={{ background: colorFor(c.name) }}>{initials(c.name)}</span>
                          {c.name}
                        </div>
                      </td>
                      <td>{c.company || <span className="muted">—</span>}</td>
                      <td>{c.source || <span className="muted">—</span>}</td>
                      <td><span className="pill">{c.score}</span></td>
                      <td>{c.email}</td>
                      <td>{c.phone || <span className="muted">—</span>}</td>
                      <td>
                        {c.tags.length
                          ? c.tags.map((t) => <span key={t} className="tag">{t}</span>)
                          : <span className="muted">—</span>}
                      </td>
                      <td>
                        {owner ? (
                          <div className="name-cell">
                            <span className="avatar" style={{ width: 22, height: 22, fontSize: 10, background: owner.color }}>
                              {initials(owner.name)}
                            </span>
                            {owner.name}
                          </div>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>{c.dealsCount}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button className="btn" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Carregando…" : `Carregar mais (${rows.length.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")})`}
            </button>
          </div>
        )}
      </div>

      {modal?.type === "form" && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{modal.data ? "Editar contato" : "Novo contato"}</h2>
              <button className="close-x" onClick={() => setModal(null)}><Icon.close /></button>
            </div>
            <form onSubmit={submitContact}>
              <div className="modal-body">
                <div className="field">
                  <label>Nome *</label>
                  <input name="name" required defaultValue={modal.data?.name} placeholder="Ex: Ana Pereira" />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Empresa</label>
                    <input name="company" defaultValue={modal.data?.company ?? ""} />
                  </div>
                  <div className="field">
                    <label>Telefone</label>
                    <input name="phone" defaultValue={modal.data?.phone ?? ""} placeholder="(11) 90000-0000" />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>E-mail</label>
                    <input name="email" type="email" defaultValue={modal.data?.email ?? ""} />
                  </div>
                  <div className="field">
                    <label>Responsável</label>
                    <select name="ownerId" defaultValue={modal.data?.ownerId ?? team[0]?.id ?? ""}>
                      <option value="">Sem responsável</option>
                      {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Origem</label>
                    <input name="source" defaultValue={modal.data?.source ?? ""} placeholder="Ex.: Tráfego pago, indicação" />
                  </div>
                  <div className="field">
                    <label>Score (0 a 100)</label>
                    <input name="score" type="number" min="0" max="100" defaultValue={modal.data?.score ?? 0} />
                  </div>
                </div>
                <div className="field">
                  <label>Tags (separadas por vírgula)</label>
                  <input name="tags" defaultValue={modal.data?.tags.join(", ") ?? ""} placeholder="VIP, E-commerce" />
                </div>
                <div className="field">
                  <label>Notas</label>
                  <textarea name="notes" defaultValue={modal.data?.notes ?? ""} />
                </div>
                <CustomFieldInputs definitions={customFieldDefs} entity="CONTACT" values={modal.data?.customFields ?? {}} />
              </div>
              <div className="modal-foot">
                {modal.data && (
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm("Mover este contato e seus negócios/agendamentos para a lixeira?")) return;
                      run(() => deleteContact(modal.data!.id)).then(() => setModal(null));
                    }}
                  >
                    <Icon.trash /> Excluir
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="btn primary" disabled={busy}>
                  {modal.data ? "Salvar" : "Criar contato"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal?.type === "import" && (
        <ImportCsvModal
          title="Importar contatos (CSV)"
          hint="Contatos sem nome são ignorados. O responsável é associado pelo nome exato de um membro da equipe (opcional)."
          templateColumns="name, company, email, phone, tags, notes, owner"
          onImport={importContactsCsv}
          onClose={() => setModal(null)}
          onDone={() => {
            setReloadKey((k) => k + 1);
            router.refresh();
          }}
        />
      )}

      {modal?.type === "segments" && (
        <SegmentsModal
          segments={segments}
          team={team}
          busy={busy}
          onApply={(seg) => {
            setActiveSegment({ id: seg.id, name: seg.name });
            setModal(null);
          }}
          onCreate={(name, conditions) => run(() => createSegment(name, "CONTACT", conditions))}
          onDelete={(id) => {
            if (activeSegment?.id === id) setActiveSegment(null);
            return run(() => deleteSegment(id));
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === "duplicates" && (
        <DuplicatesModal
          groups={duplicates}
          team={team}
          busy={busy}
          onMerge={async (keepId, mergeIds) => {
            await run(() => mergeContacts(keepId, mergeIds));
            setDuplicates(await fetchDuplicateGroups());
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === "detail" && (
        <ContactDetailModal
          detail={detail}
          team={team}
          pipelines={pipelines}
          customFieldDefs={customFieldDefs}
          tab={detailTab}
          setTab={setDetailTab}
          onClose={() => setModal(null)}
          onEdit={(c) => setModal({ type: "form", data: c })}
        />
      )}
    </>
  );
}

type BuilderCondition =
  | { field: "tag"; value: string }
  | { field: "owner"; value: string };

function SegmentsModal({
  segments,
  team,
  busy,
  onApply,
  onCreate,
  onDelete,
  onClose,
}: {
  segments: SegmentDTO[];
  team: TeamMemberDTO[];
  busy: boolean;
  onApply: (seg: SegmentDTO) => void;
  onCreate: (name: string, conditions: BuilderCondition[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [conditions, setConditions] = useState<BuilderCondition[]>([{ field: "tag", value: "" }]);

  function updateCondition(i: number, patch: Partial<BuilderCondition>) {
    setConditions((prev) => prev.map((c, idx) => (idx === i ? ({ ...c, ...patch } as BuilderCondition) : c)));
  }

  async function submitCreate() {
    const valid = conditions.filter((c) => c.value.trim());
    if (!name.trim() || valid.length === 0) return;
    await onCreate(name, valid);
    setCreating(false);
    setName("");
    setConditions([{ field: "tag", value: "" }]);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Listas salvas</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <div className="modal-body">
          {segments.length === 0 && !creating ? (
            <div className="empty-state"><Icon.empty /><div>Nenhuma lista salva ainda</div></div>
          ) : (
            segments.map((s) => (
              <div key={s.id} className="row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{s.name}</span>
                <button className="btn small" disabled={busy} onClick={() => onApply(s)}>Aplicar</button>
                <button className="btn small danger" disabled={busy} onClick={() => onDelete(s.id)}><Icon.trash /></button>
              </div>
            ))
          )}

          {creating ? (
            <div className="field" style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: 12, marginTop: 12 }}>
              <div className="field">
                <label>Nome da lista</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Clientes VIP" />
              </div>
              {conditions.map((c, i) => (
                <div key={i} className="field-row">
                  <div className="field">
                    <label>Critério</label>
                    <select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value as BuilderCondition["field"], value: "" })}>
                      <option value="tag">Tem a tag</option>
                      <option value="owner">Responsável é</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Valor</label>
                    {c.field === "owner" ? (
                      <select value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })}>
                        <option value="">Selecione...</option>
                        {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    ) : (
                      <input value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="Ex: VIP" />
                    )}
                  </div>
                </div>
              ))}
              <div className="modal-foot" style={{ padding: "8px 0 0" }}>
                <button type="button" className="btn" onClick={() => setCreating(false)}>Cancelar</button>
                <button type="button" className="btn primary" disabled={busy} onClick={submitCreate}>Salvar lista</button>
              </div>
            </div>
          ) : (
            <button className="btn primary small" style={{ marginTop: 12 }} onClick={() => setCreating(true)}>
              <Icon.plus /> Nova lista
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DuplicatesModal({
  groups,
  team,
  busy,
  onMerge,
  onClose,
}: {
  groups: DuplicateContactGroupDTO[] | null;
  team: TeamMemberDTO[];
  busy: boolean;
  onMerge: (keepId: string, mergeIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({});

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Possíveis duplicados</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: 480, overflowY: "auto" }}>
          {groups === null ? (
            <div className="empty-state"><Icon.empty /><div>Procurando duplicados…</div></div>
          ) : groups.length === 0 ? (
            <div className="empty-state"><Icon.empty /><div>Nenhum duplicado encontrado</div></div>
          ) : (
            groups.map((g) => {
              const keepId = keepByGroup[g.key] ?? g.contacts[0].id;
              return (
                <div key={g.key} className="field" style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <div className="sub" style={{ marginBottom: 8 }}>
                    Mesmo {g.matchedOn === "email" ? "e-mail" : "telefone"} — escolha quem fica:
                  </div>
                  {g.contacts.map((c) => {
                    const owner = team.find((m) => m.id === c.ownerId);
                    return (
                      <label key={c.id} className="name-cell" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name={`keep-${g.key}`}
                          checked={keepId === c.id}
                          onChange={() => setKeepByGroup((prev) => ({ ...prev, [g.key]: c.id }))}
                        />
                        <span className="avatar" style={{ width: 22, height: 22, fontSize: 10, background: colorFor(c.name) }}>{initials(c.name)}</span>
                        <span>{c.name}</span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {c.email || "—"} · {c.phone || "—"} {owner ? `· ${owner.name}` : ""}
                        </span>
                      </label>
                    );
                  })}
                  <div style={{ textAlign: "right", marginTop: 8 }}>
                    <button
                      className="btn primary small"
                      disabled={busy}
                      onClick={() => {
                        const mergeIds = g.contacts.map((c) => c.id).filter((id) => id !== keepId);
                        if (!confirm("Mesclar esses contatos? Os descartados vão para a lixeira (restauráveis em Lixeira).")) return;
                        onMerge(keepId, mergeIds);
                      }}
                    >
                      Mesclar neste
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function ContactDetailModal({
  detail,
  team,
  pipelines,
  customFieldDefs,
  tab,
  setTab,
  onClose,
  onEdit,
}: {
  detail: Detail | null | "missing";
  team: TeamMemberDTO[];
  pipelines: PipelineDTO[];
  customFieldDefs: CustomFieldDefinitionDTO[];
  tab: "perfil" | "negocios" | "conversa" | "atividade";
  setTab: (t: "perfil" | "negocios" | "conversa" | "atividade") => void;
  onClose: () => void;
  onEdit: (c: ContactDTO) => void;
}) {
  if (detail === null || detail === "missing") {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal wide" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Detalhes do contato</h2>
            <button className="close-x" onClick={onClose}><Icon.close /></button>
          </div>
          <div className="modal-body">
            <div className="empty-state">
              <Icon.empty />
              <div>{detail === "missing" ? "Contato não encontrado (pode ter sido apagado)." : "Carregando…"}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { contact, opportunities, messages, activities, conversationHidden } = detail;
  const owner = team.find((m) => m.id === contact.ownerId);
  const opportunityValue = opportunities.reduce((total, opportunity) => total + opportunity.value, 0);
  const latestMessage = messages[messages.length - 1];
  const filledCustomFields = customFieldDefs
    .filter((field) => field.entity === "CONTACT")
    .map((field) => ({ ...field, value: contact.customFields[field.key] }))
    .filter((field) => field.value !== undefined && field.value !== null && field.value !== "");

  function stageOf(o: OpportunityDTO) {
    for (const p of pipelines) {
      const s = p.stages.find((st) => st.id === o.stageId);
      if (s) return { stage: s, pipelineName: p.name };
    }
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Detalhes do contato</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <div className="detail-head">
          <span className="avatar lg" style={{ background: colorFor(contact.name) }}>{initials(contact.name)}</span>
          <div className="hinfo">
            <div className="hname">{contact.name}</div>
            <div className="hcompany">{contact.company || contact.email}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn small" onClick={() => onEdit(contact)}>Editar</button>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === "perfil" ? "active" : ""}`} onClick={() => setTab("perfil")}>Perfil</button>
          <button className={`tab ${tab === "negocios" ? "active" : ""}`} onClick={() => setTab("negocios")}>
            Oportunidades ({opportunities.length})
          </button>
          <button className={`tab ${tab === "conversa" ? "active" : ""}`} onClick={() => setTab("conversa")}>Conversa</button>
          <button className={`tab ${tab === "atividade" ? "active" : ""}`} onClick={() => setTab("atividade")}>
            Atividades ({activities.length})
          </button>
        </div>

        {tab === "perfil" && (
          <div className="modal-body">
            <div className="contact-insights">
              <div><span>Oportunidades</span><strong>{opportunities.length}</strong></div>
              <div><span>Valor em negociação</span><strong>{fmtMoney(opportunityValue)}</strong></div>
              <div><span>Última interação</span><strong>{latestMessage ? fmtDate(latestMessage.time) : "Sem conversa"}</strong></div>
            </div>
            <div className="info-grid">
              <div className="info-row"><span className="k">Empresa</span><span className="v">{contact.company || "—"}</span></div>
              <div className="info-row"><span className="k">Cliente desde</span><span className="v">{fmtDate(contact.createdAt)}</span></div>
              <div className="info-row"><span className="k">E-mail</span><span className="v">{contact.email || "—"}</span></div>
              <div className="info-row"><span className="k">Telefone</span><span className="v">{contact.phone || "—"}</span></div>
              <div className="info-row"><span className="k">Responsável</span><span className="v">{owner ? owner.name : "—"}</span></div>
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <label>Tags</label>
              <div>
                {contact.tags.length
                  ? contact.tags.map((t) => <span key={t} className="tag">{t}</span>)
                  : <span className="muted">Nenhuma tag</span>}
              </div>
            </div>
            <div className="field">
              <label>Notas</label>
              <div style={{ fontSize: 13, color: "var(--text-soft)", whiteSpace: "pre-wrap" }}>
                {contact.notes || "Sem notas."}
              </div>
            </div>
            {filledCustomFields.length > 0 && (
              <div className="field">
                <label>Informações adicionais</label>
                <div className="info-grid contact-custom-fields">
                  {filledCustomFields.map((field) => (
                    <div key={field.id} className="info-row">
                      <span className="k">{field.label}</span>
                      <span className="v">{typeof field.value === "boolean" ? (field.value ? "Sim" : "Não") : String(field.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "negocios" && (
          <div className="modal-body">
            {opportunities.length === 0 ? (
              <div className="empty-state"><Icon.empty /><div>Nenhuma oportunidade vinculada</div></div>
            ) : (
              opportunities.map((d) => {
                const info = stageOf(d);
                return (
                  <div key={d.id} className="mini-deal">
                    <div>
                      <div className="t">{d.title}</div>
                      <div className="s">
                        {fmtMoney(d.value)} · {info?.pipelineName} · previsão {d.expectedClose ? fmtDate(d.expectedClose) : "—"}
                      </div>
                      {d.tags.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          {d.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                        </div>
                      )}
                    </div>
                    {info && (
                      <span className="pill" style={{ background: info.stage.color + "22", color: info.stage.color }}>
                        {info.stage.label}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "conversa" && (
          <div className="modal-body" style={{ maxHeight: 340, overflowY: "auto" }}>
            {conversationHidden ? (
              <div className="empty-state"><Icon.empty /><div>A conversa deste contato é de outro atendente.</div></div>
            ) : messages.length === 0 ? (
              <div className="empty-state"><Icon.empty /><div>Sem conversas ainda</div></div>
            ) : (
              <>
                {messages.length >= 100 && (
                  <div className="muted" style={{ fontSize: 11, textAlign: "center", marginBottom: 8 }}>
                    Mostrando as 100 mensagens mais recentes. O histórico completo está em Conversas.
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`bubble-row ${m.direction === "out" ? "me" : "them"}`} style={{ marginBottom: 8 }}>
                    <div className="bubble">{m.text}<span className="time">{fmtTime(m.time)}</span></div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === "atividade" && (
          <div className="modal-body">
            {activities.length === 0 ? (
              <div className="empty-state"><Icon.tasks /><div>Nenhuma atividade planejada para este contato.</div></div>
            ) : (
              <div className="contact-timeline">
                {activities.map((activity) => (
                  <div key={activity.id} className={`timeline-item ${activity.done ? "done" : ""}`}>
                    <span className="timeline-dot" />
                    <div>
                      <strong>{activity.title}</strong>
                      <p>{activity.type === "TASK" ? "Tarefa" : activity.type === "CALL" ? "Ligação" : "Reunião"} · {fmtDate(activity.dueAt)} {activity.done ? "· concluída" : "· pendente"}</p>
                      {activity.notes && <span>{activity.notes}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <a className="btn small" style={{ marginTop: 14 }} href={`/activities?contact=${contact.id}`}>Gerenciar atividades</a>
          </div>
        )}
      </div>
    </div>
  );
}
