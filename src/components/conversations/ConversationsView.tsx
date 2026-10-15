"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { colorFor, initials, timeAgo, fmtDate, fmtMoney, fmtTime } from "@/lib/format";
import type {
  ContactDTO,
  ConversationChannelInfo,
  ConversationRowDTO,
  MessageDTO,
  MessageTemplateDTO,
  OpportunityDTO,
  Page,
  SendOptionDTO,
  TeamMemberDTO,
} from "@/lib/types";
import { sendMessage, fetchSendOptions } from "@/app/conversations/actions";
import { fetchContactDetail, fetchConversations, fetchThread } from "@/app/listings/actions";
import { reassignContactOwner } from "@/app/contacts/actions";
import { createMessageTemplate, deleteMessageTemplate } from "@/app/templates/actions";

const PROVIDER_LABEL: Record<NonNullable<ConversationChannelInfo>["provider"], string> = {
  WHATSAPP_EVOLUTION: "WhatsApp",
  INSTAGRAM: "Instagram",
  EMAIL: "E-mail",
};

// Substitui placeholders simples pelos dados do contato ({{nome}}, {{empresa}}).
function resolveTemplate(body: string, contact: ContactDTO): string {
  return body
    .replaceAll("{{nome}}", contact.name)
    .replaceAll("{{empresa}}", contact.company || "")
    .replaceAll("{{email}}", contact.email || "");
}

function ChannelBadge({ channel }: { channel: ConversationChannelInfo }) {
  if (!channel) {
    return <span className="pill" style={{ background: "var(--border-soft)", color: "var(--text-faint)" }}>Sem canal</span>;
  }
  return (
    <span className="pill" style={{ background: "var(--green-soft)", color: "var(--green)" }}>
      {PROVIDER_LABEL[channel.provider]} · {channel.label}
    </span>
  );
}

const POLL_MS = 8000;
const SEARCH_DEBOUNCE_MS = 300;

type CustomerDetail = {
  contact: ContactDTO;
  opportunities: OpportunityDTO[];
  messages: MessageDTO[];
  conversationHidden: boolean;
};

// Junta mensagens novas às já carregadas, sem duplicar e em ordem cronológica.
function mergeMessages(current: MessageDTO[], incoming: MessageDTO[]): MessageDTO[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.time === b.time ? (a.id < b.id ? -1 : 1) : a.time < b.time ? -1 : 1));
}

export function ConversationsView({
  initialPage,
  initialChannels,
  initialThread,
  initialSendOptions,
  team,
  currentUserRole,
  templates,
}: {
  initialPage: Page<ConversationRowDTO>;
  initialChannels: Record<string, ConversationChannelInfo>;
  /** Mensagens da primeira conversa, já carregadas pelo servidor. */
  initialThread: Page<MessageDTO> | null;
  /** Canais de envio da primeira conversa. */
  initialSendOptions: SendOptionDTO[];
  team: TeamMemberDTO[];
  currentUserRole: "ADMIN" | "MEMBER";
  templates: MessageTemplateDTO[];
}) {
  const router = useRouter();

  // Lista de conversas (paginada) e canais só dos contatos carregados.
  const [rows, setRows] = useState<ConversationRowDTO[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [channels, setChannels] = useState(initialChannels);
  const [search, setSearch] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Conversa aberta: mensagens da mais recente para trás, sob demanda.
  const [selectedId, setSelectedId] = useState<string | null>(initialPage.items[0]?.contact.id ?? null);
  const [selectedContact, setSelectedContact] = useState<ContactDTO | null>(initialPage.items[0]?.contact ?? null);
  const [messages, setMessages] = useState<MessageDTO[]>(initialThread?.items ?? []);
  const [olderCursor, setOlderCursor] = useState<string | null>(initialThread?.nextCursor ?? null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Toda mensagem sai por um canal real. Aqui ficam os canais do contato aberto,
  // o escolhido para enviar e o último erro de envio.
  const [sendOptions, setSendOptions] = useState<SendOptionDTO[]>(initialSendOptions);
  const [chosenConnection, setChosenConnection] = useState<string>("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null);
  const [customerDetailLoading, setCustomerDetailLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listSeq = useRef(0);
  const threadSeq = useRef(0);
  const selectedIdRef = useRef<string | null>(initialPage.items[0]?.contact.id ?? null);
  const pagesLoaded = useRef(1);
  const skipFirstListLoad = useRef(true);

  function ownerOf(contact: ContactDTO) {
    return contact.ownerId ? team.find((m) => m.id === contact.ownerId) : undefined;
  }

  // A conversa aberta continua na tela mesmo que a busca da lista deixe de
  // listá-la: guardamos o contato escolhido além das linhas carregadas.
  const activeRow = rows.find((r) => r.contact.id === selectedId) ?? null;
  const activeContact = activeRow?.contact ?? (selectedContact?.id === selectedId ? selectedContact : null);
  const activeChannel = activeContact ? channels[activeContact.id] ?? null : null;
  const activeOwner = activeContact ? ownerOf(activeContact) : undefined;

  // ── Lista: busca (no servidor) e "carregar mais" ──────────────────────────
  const reloadList = useCallback(
    async (q: string) => {
      const mine = ++listSeq.current;
      setListLoading(true);
      try {
        const { page, channels: ch } = await fetchConversations({ q: q.trim() || undefined });
        if (mine !== listSeq.current) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
        setChannels(ch);
        pagesLoaded.current = 1;
      } finally {
        if (mine === listSeq.current) setListLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (skipFirstListLoad.current) {
      skipFirstListLoad.current = false;
      return;
    }
    const timer = setTimeout(() => reloadList(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, reloadList]);

  async function loadMoreConversations() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const mine = listSeq.current;
    try {
      const { page, channels: ch } = await fetchConversations({ q: search.trim() || undefined, cursor: nextCursor });
      if (mine !== listSeq.current) return;
      setRows((prev) => [...prev, ...page.items.filter((r) => !prev.some((p) => p.contact.id === r.contact.id))]);
      setNextCursor(page.nextCursor);
      setChannels((prev) => ({ ...prev, ...ch }));
      pagesLoaded.current += 1;
    } finally {
      setLoadingMore(false);
    }
  }

  // ── Conversa aberta: carrega as mensagens mais recentes ao trocar de contato ─
  const loadThread = useCallback(async (contactId: string) => {
    const mine = ++threadSeq.current;
    setThreadLoading(true);
    try {
      const page = await fetchThread(contactId);
      if (mine !== threadSeq.current) return;
      setMessages(page?.items ?? []);
      setOlderCursor(page?.nextCursor ?? null);
    } finally {
      if (mine === threadSeq.current) setThreadLoading(false);
    }
  }, []);

  // Trocar de conversa limpa a tela e busca as mensagens da nova (feito no
  // clique, não num efeito: assim não há renderização com a conversa errada).
  function openConversation(c: ContactDTO) {
    if (c.id === selectedId) return;
    selectedIdRef.current = c.id;
    setSelectedId(c.id);
    setSelectedContact(c);
    setMessages([]);
    setOlderCursor(null);
    setSendOptions([]);
    setChosenConnection("");
    setSendError(null);
    setCustomerPanelOpen(false);
    setCustomerDetail(null);
    loadThread(c.id);
    fetchSendOptions(c.id).then((opts) => {
      if (selectedIdRef.current === c.id) setSendOptions(opts); // ignora se já trocou de conversa
    });
  }

  async function loadOlder() {
    if (!selectedId || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const el = bodyRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await fetchThread(selectedId, olderCursor);
      if (!page) return;
      setMessages((prev) => mergeMessages(prev, page.items));
      setOlderCursor(page.nextCursor);
      // mantém a leitura no mesmo ponto depois de inserir mensagens acima
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  // Rola para a última mensagem ao abrir a conversa e quando chega mensagem nova.
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId, lastMessageId]);

  // ── Atualização periódica (no lugar de tempo real) ────────────────────────
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        // Lista: só se o usuário não está buscando nem paginou (senão apagaria o que ele carregou).
        if (!search.trim() && pagesLoaded.current === 1) {
          const { page, channels: ch } = await fetchConversations();
          setRows(page.items);
          setNextCursor(page.nextCursor);
          setChannels((prev) => ({ ...prev, ...ch }));
        }
        if (selectedId) {
          const page = await fetchThread(selectedId);
          if (page) setMessages((prev) => mergeMessages(prev, page.items));
        }
      } catch {
        // falha de rede momentânea: tenta de novo no próximo ciclo
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [search, selectedId]);

  async function refreshNow() {
    if (!search.trim() && pagesLoaded.current === 1) {
      const { page, channels: ch } = await fetchConversations();
      setRows(page.items);
      setNextCursor(page.nextCursor);
      setChannels((prev) => ({ ...prev, ...ch }));
    }
    if (selectedId) {
      const page = await fetchThread(selectedId);
      if (page) setMessages((prev) => mergeMessages(prev, page.items));
    }
  }

  async function openCustomerPanel() {
    if (!activeContact) return;
    setCustomerPanelOpen(true);
    setCustomerDetail(null);
    setCustomerDetailLoading(true);
    try {
      const detail = await fetchContactDetail(activeContact.id);
      setCustomerDetail(detail);
    } finally {
      setCustomerDetailLoading(false);
    }
  }

  async function handleSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeContact || !inputRef.current) return;
    const text = inputRef.current.value.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      const contactId = activeContact.id;
      const result = await sendMessage(contactId, text, chosenConnection || undefined);
      if (!result.ok) {
        // Nada foi enviado nem gravado: o texto continua no campo para tentar de novo.
        setSendError(result.error);
        return;
      }
      inputRef.current.value = "";
      if (result.status === "failed") {
        setSendError(`A mensagem foi registrada, mas o canal recusou o envio${result.error ? `: ${result.error}` : ""}.`);
      }
      await refreshNow();
      // O envio pode ter criado o vínculo com o canal (primeira conversa).
      setSendOptions(await fetchSendOptions(contactId));
    } finally {
      setSending(false);
    }
  }

  // Canais prontos para enviar agora (conectados). Se houver mais de um, o
  // atendente escolhe; se não houver nenhum, o envio fica bloqueado.
  const usableChannels = sendOptions.filter((o) => o.connected);
  const PROVIDER_NAME: Record<SendOptionDTO["provider"], string> = {
    WHATSAPP_EVOLUTION: "WhatsApp",
    INSTAGRAM: "Instagram",
    EMAIL: "E-mail",
  };
  const noChannelReason =
    sendOptions.length === 0
      ? "Este contato não tem um canal de conversa (WhatsApp, Instagram ou e-mail). Cadastre o telefone do contato e conecte um canal em Conexões, ou espere ele escrever primeiro."
      : "O canal deste contato está desconectado. Reconecte-o em Conexões para enviar.";

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Conversas</h1>
          <div className="sub">
            {currentUserRole === "ADMIN"
              ? "Converse com seus contatos em um só lugar"
              : "Suas conversas atribuídas — colegas não aparecem aqui"}
          </div>
        </div>
      </div>
      <div className="content">
        <div className="convo-layout">
          <div className="convo-list">
            <div className="search-bar" style={{ margin: 8 }}>
              <Icon.search />
              <input
                placeholder="Buscar contato para conversar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {rows.length === 0 ? (
              <div className="thread-empty" style={{ padding: 24 }}>
                <Icon.chat />
                <div>
                  {listLoading
                    ? "Buscando…"
                    : search.trim()
                      ? "Nenhum contato encontrado"
                      : "Nenhuma conversa atribuída a você ainda"}
                </div>
              </div>
            ) : (
              <>
                {rows.map(({ contact: c, lastText, lastTime }) => {
                  const owner = ownerOf(c);
                  const channel = channels[c.id] ?? null;
                  return (
                    <div
                      key={c.id}
                      className={`convo-item ${selectedId === c.id ? "active" : ""}`}
                      onClick={() => openConversation(c)}
                    >
                      <span className="avatar md" style={{ background: colorFor(c.name) }}>{initials(c.name)}</span>
                      <div className="meta">
                        <div className="top-row">
                          <span className="cname">{c.name}</span>
                          {lastTime && <span className="ctime">{timeAgo(lastTime)}</span>}
                        </div>
                        <div className="preview">{lastText ?? "Sem mensagens ainda"}</div>
                        <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                          <ChannelBadge channel={channel} />
                          {currentUserRole === "ADMIN" && owner && (
                            <span className="muted" style={{ fontSize: 11 }}>· {owner.name}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {nextCursor && (
                  <div style={{ textAlign: "center", padding: 10 }}>
                    <button className="btn small" onClick={loadMoreConversations} disabled={loadingMore}>
                      {loadingMore ? "Carregando…" : "Carregar mais conversas"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="convo-thread">
            {!activeContact ? (
              <div className="thread-empty"><Icon.chat /><div>Selecione uma conversa</div></div>
            ) : (
              <>
                <div className="thread-head">
                  <span className="avatar md" style={{ background: colorFor(activeContact.name) }}>
                    {initials(activeContact.name)}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="hname">{activeContact.name}</div>
                    <div className="hsub">{activeContact.company || activeContact.email}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <ChannelBadge channel={activeChannel} />
                    {currentUserRole === "ADMIN" ? (
                      <select
                        value={activeContact.ownerId ?? ""}
                        onChange={async (e) => {
                          const ownerId = e.target.value || null;
                          await reassignContactOwner(activeContact.id, ownerId);
                          setRows((prev) =>
                            prev.map((r) => (r.contact.id === activeContact.id ? { ...r, contact: { ...r.contact, ownerId } } : r))
                          );
                          setSelectedContact((prev) => (prev ? { ...prev, ownerId } : prev));
                          router.refresh();
                        }}
                        style={{ fontSize: 11, padding: "2px 4px" }}
                      >
                        <option value="">Sem responsável</option>
                        {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    ) : (
                      activeOwner && <span className="muted" style={{ fontSize: 11 }}>Atende: {activeOwner.name}</span>
                    )}
                  </div>
                  <button type="button" className="btn small" onClick={openCustomerPanel}>Ficha</button>
                </div>
                <div className="thread-body" ref={bodyRef}>
                  {olderCursor && (
                    <div style={{ textAlign: "center", marginBottom: 8 }}>
                      <button className="btn small ghost" onClick={loadOlder} disabled={loadingOlder}>
                        {loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}
                      </button>
                    </div>
                  )}
                  {messages.length === 0 ? (
                    <div className="thread-empty">
                      <Icon.empty />
                      <div>{threadLoading ? "Carregando…" : "Nenhuma mensagem ainda. Diga olá!"}</div>
                    </div>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} className={`bubble-row ${m.direction === "out" ? "me" : "them"}`}>
                        <div className="bubble">
                          {m.text}
                          <span className="time">{fmtTime(m.time)}</span>
                          {m.status === "failed" && (
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#fecaca", marginTop: 2 }}>
                              ⚠ Não foi entregue — o canal recusou o envio
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {usableChannels.length === 0 ? (
                  <div
                    role="alert"
                    style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "var(--orange)", background: "var(--orange-soft, #fff7ed)", borderTop: "1px solid var(--border-soft)" }}
                  >
                    {noChannelReason}
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px 0", fontSize: 12 }}>
                    <span className="muted">Enviar por:</span>
                    {usableChannels.length > 1 ? (
                      <select
                        value={chosenConnection || usableChannels[0].connectionId}
                        onChange={(e) => setChosenConnection(e.target.value)}
                        style={{ fontSize: 12, padding: "2px 6px" }}
                      >
                        {usableChannels.map((o) => (
                          <option key={o.connectionId} value={o.connectionId}>
                            {PROVIDER_NAME[o.provider]} · {o.label}
                            {o.existing ? "" : " (iniciar conversa)"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="pill" style={{ background: "var(--green-soft)", color: "var(--green)" }}>
                        {PROVIDER_NAME[usableChannels[0].provider]} · {usableChannels[0].label}
                        {usableChannels[0].existing ? "" : " (iniciar conversa)"}
                      </span>
                    )}
                  </div>
                )}
                {sendError && (
                  <div role="alert" style={{ padding: "6px 16px 0", fontSize: 12, fontWeight: 600, color: "var(--red)" }}>
                    {sendError}
                  </div>
                )}
                <form className="thread-input" onSubmit={handleSend} style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setTemplatesOpen((v) => !v)}
                  >
                    Modelos
                  </button>
                  <input
                    ref={inputRef}
                    placeholder={usableChannels.length === 0 ? "Sem canal para enviar" : "Escreva uma mensagem..."}
                    autoComplete="off"
                    disabled={usableChannels.length === 0}
                  />
                  <button type="submit" className="btn primary icon-only" disabled={sending || usableChannels.length === 0}><Icon.send /></button>

                  {templatesOpen && (
                    <div className="modal" style={{ position: "absolute", bottom: "100%", left: 0, width: 320, maxHeight: 260, overflowY: "auto", marginBottom: 8, zIndex: 10 }}>
                      <div className="modal-body" style={{ padding: 8 }}>
                        {templates.length === 0 ? (
                          <div className="muted" style={{ fontSize: 12, padding: 8 }}>Nenhum modelo salvo ainda.</div>
                        ) : (
                          templates.map((t) => (
                            <div
                              key={t.id}
                              className="row"
                              style={{ padding: "6px 8px", cursor: "pointer", borderRadius: 6 }}
                              onClick={() => {
                                if (inputRef.current && activeContact) {
                                  inputRef.current.value = resolveTemplate(t.body, activeContact);
                                  inputRef.current.focus();
                                }
                                setTemplatesOpen(false);
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                              <div className="muted" style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.body}</div>
                            </div>
                          ))
                        )}
                        <button
                          type="button"
                          className="btn small ghost"
                          style={{ width: "100%", marginTop: 6 }}
                          onClick={() => {
                            setTemplatesOpen(false);
                            setManageTemplatesOpen(true);
                          }}
                        >
                          Gerenciar modelos
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              </>
            )}
          </div>
          {customerPanelOpen && (
            <aside className="conversation-context" aria-label="Ficha rápida do contato">
              <div className="conversation-context-head">
                <div>
                  <span>FICHA DO CONTATO</span>
                  <strong>{activeContact?.name}</strong>
                </div>
                <button type="button" className="close-x" onClick={() => setCustomerPanelOpen(false)}><Icon.close /></button>
              </div>
              {customerDetailLoading || !customerDetail ? (
                <div className="thread-empty"><Icon.empty /><div>Carregando ficha…</div></div>
              ) : (
                <>
                  <div className="context-contact-lines">
                    <a href={customerDetail.contact.email ? `mailto:${customerDetail.contact.email}` : undefined}>{customerDetail.contact.email || "Sem e-mail"}</a>
                    <a href={customerDetail.contact.phone ? `tel:${customerDetail.contact.phone}` : undefined}>{customerDetail.contact.phone || "Sem telefone"}</a>
                    <span>Responsável: {ownerOf(customerDetail.contact)?.name ?? "Não definido"}</span>
                  </div>
                  <div className="context-tags">
                    {customerDetail.contact.tags.length ? customerDetail.contact.tags.map((tag) => <span key={tag} className="tag">{tag}</span>) : <span className="muted">Sem tags</span>}
                  </div>
                  <div className="context-stat-grid">
                    <div><span>Oportunidades</span><strong>{customerDetail.opportunities.length}</strong></div>
                    <div><span>Em negociação</span><strong>{fmtMoney(customerDetail.opportunities.reduce((sum, opportunity) => sum + opportunity.value, 0))}</strong></div>
                  </div>
                  <section className="context-section">
                    <div className="context-section-title">Oportunidades</div>
                    {customerDetail.opportunities.length === 0 ? <span className="muted">Nenhuma oportunidade cadastrada.</span> : customerDetail.opportunities.slice(0, 4).map((opportunity) => (
                      <div key={opportunity.id} className="context-opportunity">
                        <strong>{opportunity.title}</strong>
                        <span>{fmtMoney(opportunity.value)}{opportunity.expectedClose ? ` · ${fmtDate(opportunity.expectedClose)}` : ""}</span>
                      </div>
                    ))}
                  </section>
                  <section className="context-section">
                    <div className="context-section-title">Notas</div>
                    <p>{customerDetail.contact.notes || "Nenhuma nota cadastrada."}</p>
                  </section>
                  <a className="btn primary" href={`/contacts?contact=${customerDetail.contact.id}`}>Abrir ficha completa</a>
                </>
              )}
            </aside>
          )}
        </div>
      </div>

      {manageTemplatesOpen && (
        <ManageTemplatesModal
          templates={templates}
          onClose={() => setManageTemplatesOpen(false)}
          onRefresh={() => router.refresh()}
        />
      )}
    </>
  );
}

function ManageTemplatesModal({
  templates,
  onClose,
  onRefresh,
}: {
  templates: MessageTemplateDTO[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !body.trim()) return;
    setBusy(true);
    try {
      await createMessageTemplate(name, body);
      setName("");
      setBody("");
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await deleteMessageTemplate(id);
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Modelos de mensagem</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <div className="modal-body">
          {templates.length === 0 ? (
            <div className="empty-state"><Icon.empty /><div>Nenhum modelo salvo</div></div>
          ) : (
            templates.map((t) => (
              <div key={t.id} className="row" style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{t.body}</div>
                </div>
                <button className="btn small danger" disabled={busy} onClick={() => handleDelete(t.id)}><Icon.trash /></button>
              </div>
            ))
          )}
          <form onSubmit={handleCreate} style={{ marginTop: 14, borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
            <div className="field">
              <label>Nome do modelo</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Boas-vindas" />
            </div>
            <div className="field">
              <label>Texto (use {"{{nome}}"}, {"{{empresa}}"}, {"{{email}}"})</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Olá {{nome}}, tudo bem?" />
            </div>
            <button type="submit" className="btn primary small" disabled={busy}>Salvar modelo</button>
          </form>
        </div>
      </div>
    </div>
  );
}
