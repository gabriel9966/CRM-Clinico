"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { colorFor, initials, timeAgo, fmtDate, fmtMoney, fmtTime } from "@/lib/format";
import type {
  ContactDTO,
  ActivityDTO,
  ConversationChannelInfo,
  ConversationRowDTO,
  ConversationEventDTO,
  ConnectionDTO,
  MessageDTO,
  MessageTemplateDTO,
  OpportunityDTO,
  PipelineDTO,
  Page,
  SendOptionDTO,
  TeamMemberDTO,
} from "@/lib/types";
import { addPrivateNote, assignConversation, fetchConversationEvents, fetchConversationSendOptions, fetchPrivateNotes, linkConversationChannel, retryFailedMessage, sendMessage, setConversationStatus, updateConversationTags, type PrivateNoteDTO } from "@/app/conversations/actions";
import { fetchContactDetail, fetchConversationThread, fetchConversations } from "@/app/listings/actions";
import { createMessageTemplate, deleteMessageTemplate } from "@/app/templates/actions";
import { createActivity, type ActivityInput } from "@/app/activities/actions";
import { createOpportunity } from "@/app/pipeline/actions";

const PROVIDER_LABEL: Record<NonNullable<ConversationChannelInfo>["provider"], string> = {
  WHATSAPP_EVOLUTION: "WhatsApp",
  WHATSAPP_AZAP: "WhatsApp · AZAP",
  WHATSAPP_CLOUD: "WhatsApp · Oficial",
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
  activities: ActivityDTO[];
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
  initialThread,
  initialSendOptions,
  team,
  currentUserRole,
  currentUserId,
  templates,
  pipelines,
  connections,
  tags,
}: {
  initialPage: Page<ConversationRowDTO>;
  /** Mensagens da primeira conversa, já carregadas pelo servidor. */
  initialThread: Page<MessageDTO> | null;
  /** Canais de envio da primeira conversa. */
  initialSendOptions: SendOptionDTO[];
  team: TeamMemberDTO[];
  currentUserRole: "ADMIN" | "MEMBER";
  currentUserId: string;
  templates: MessageTemplateDTO[];
  pipelines: PipelineDTO[];
  connections: ConnectionDTO[];
  tags: string[];
}) {
  const router = useRouter();

  // Lista de conversas (paginada) e canais só dos contatos carregados.
  const [rows, setRows] = useState<ConversationRowDTO[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ ownerId: "", team: "", connectionId: "", provider: "", tag: "", stageId: "", status: "OPEN", from: "", to: "" });
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Conversa aberta: mensagens da mais recente para trás, sob demanda.
  const [selectedId, setSelectedId] = useState<string | null>(initialPage.items[0]?.id ?? null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<ConversationRowDTO | null>(initialPage.items[0] ?? null);
  const [selectedContact, setSelectedContact] = useState<ContactDTO | null>(initialPage.items[0]?.contact ?? null);
  const [messages, setMessages] = useState<MessageDTO[]>(initialThread?.items ?? []);
  const [privateNotes, setPrivateNotes] = useState<PrivateNoteDTO[]>([]);
  const [composerMode, setComposerMode] = useState<"message" | "private">("message");
  const [olderCursor, setOlderCursor] = useState<string | null>(initialThread?.nextCursor ?? null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Toda mensagem sai por um canal real. Aqui ficam os canais do contato aberto,
  // o escolhido para enviar e o último erro de envio.
  const [sendOptions, setSendOptions] = useState<SendOptionDTO[]>(initialSendOptions);
  const [chosenConnection, setChosenConnection] = useState<string>("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [linkingChannel, setLinkingChannel] = useState(false);
  const [windowNow, setWindowNow] = useState(() => Date.now());
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null);
  const [customerDetailLoading, setCustomerDetailLoading] = useState(false);
  const [events, setEvents] = useState<ConversationEventDTO[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [quickAction, setQuickAction] = useState<"task" | "opportunity" | null>(null);
  const [quickActionBusy, setQuickActionBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageDraft = useRef("");
  const noteDraft = useRef("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const listSeq = useRef(0);
  const threadSeq = useRef(0);
  const selectedIdRef = useRef<string | null>(initialPage.items[0]?.id ?? null);
  const pagesLoaded = useRef(1);
  const skipFirstListLoad = useRef(true);
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1100px)").matches) return;
    const frame = requestAnimationFrame(() => setCustomerPanelOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function ownerOf(ownerId: string | null) {
    return ownerId ? team.find((m) => m.id === ownerId) : undefined;
  }

  // A conversa aberta continua na tela mesmo que a busca da lista deixe de
  // listá-la: guardamos o contato escolhido além das linhas carregadas.
  const activeRow = rows.find((r) => r.id === selectedId) ?? selectedSnapshot;
  const activeContact = activeRow?.contact ?? selectedContact;
  const activeChannel = activeRow?.channel ?? null;
  const cloudWindowEnds = activeChannel?.provider === "WHATSAPP_CLOUD" && activeRow?.lastInboundAt
    ? new Date(activeRow.lastInboundAt).getTime() + 24 * 60 * 60 * 1000 : null;
  const cloudWindowOpen = cloudWindowEnds !== null && cloudWindowEnds > windowNow;
  const cloudWindowClosed = activeChannel?.provider === "WHATSAPP_CLOUD" && !cloudWindowOpen;
  useEffect(() => { const timer = setInterval(() => setWindowNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const activeOwner = ownerOf(activeRow?.ownerId ?? null);
  const defaultPipeline = pipelines[0];
  const linkedChannels = sendOptions.filter((option) => option.existing);
  const filtersApplied = Object.entries(filters).filter(([key, value]) => value && !(key === "status" && value === "OPEN")).length;

  async function changeAssignee(ownerId: string | null, mode: "assign" | "transfer" | "claim" = "assign") {
    if (!activeRow) return;
    const result = await assignConversation(activeRow.id, ownerId, mode);
    if (!result.ok) { setSendError(result.error ?? "Não foi possível atribuir o atendimento."); return; }
    setRows((prev) => prev.map((row) => (row.id === activeRow.id ? { ...row, ownerId } : row)));
    setSelectedSnapshot((row) => row?.id === activeRow.id ? { ...row, ownerId } : row);
    router.refresh();
  }

  async function changeStatus(status: "OPEN" | "CLOSED") {
    if (!activeRow) return;
    const result = await setConversationStatus(activeRow.id, status);
    if (!result.ok) { setSendError(result.error ?? "Não foi possível alterar o atendimento."); return; }
    setRows((prev) => prev.map((row) => row.id === activeRow.id ? { ...row, status } : row));
    setSelectedSnapshot((row) => row?.id === activeRow.id ? { ...row, status } : row);
    router.refresh();
  }

  async function chooseConversationChannel(connectionId: string) {
    if (!activeRow || !connectionId || linkingChannel) return;
    setLinkingChannel(true);
    setSendError(null);
    try {
      const result = await linkConversationChannel(activeRow.id, connectionId);
      if (!result.ok) {
        setSendError(result.error);
        return;
      }
      const option = sendOptions.find((item) => item.connectionId === connectionId);
      if (!option) return;
      const channel = { connectionId, provider: option.provider, label: option.label, externalName: null };
      setRows((items) => items.map((item) => item.id === activeRow.id ? { ...item, channel } : item));
      setSelectedSnapshot((item) => item?.id === activeRow.id ? { ...item, channel } : item);
      setChosenConnection(connectionId);
      setSendOptions(await fetchConversationSendOptions(activeRow.id));
      router.refresh();
    } finally {
      setLinkingChannel(false);
    }
  }

  // ── Lista: busca (no servidor) e "carregar mais" ──────────────────────────
  const reloadList = useCallback(
    async (q: string) => {
      const mine = ++listSeq.current;
      setListLoading(true);
      try {
        const { page } = await fetchConversations({ q: q.trim() || undefined, ...filters, provider: (filters.provider || undefined) as NonNullable<ConnectionDTO["provider"]> | undefined, status: filters.status as "OPEN" | "CLOSED" | "ALL" });
        if (mine !== listSeq.current) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
        pagesLoaded.current = 1;
      } finally {
        if (mine === listSeq.current) setListLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    if (skipFirstListLoad.current) {
      skipFirstListLoad.current = false;
      return;
    }
    const timer = setTimeout(() => reloadList(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters, reloadList]);

  async function loadMoreConversations() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const mine = listSeq.current;
    try {
      const { page } = await fetchConversations({ q: search.trim() || undefined, cursor: nextCursor, ...filters, provider: (filters.provider || undefined) as NonNullable<ConnectionDTO["provider"]> | undefined, status: filters.status as "OPEN" | "CLOSED" | "ALL" });
      if (mine !== listSeq.current) return;
      setRows((prev) => [...prev, ...page.items.filter((r) => !prev.some((p) => p.id === r.id))]);
      setNextCursor(page.nextCursor);
      pagesLoaded.current += 1;
    } finally {
      setLoadingMore(false);
    }
  }

  // ── Conversa aberta: carrega as mensagens mais recentes ao trocar de contato ─
  const loadThread = useCallback(async (conversationId: string) => {
    const mine = ++threadSeq.current;
    setThreadLoading(true);
    try {
      const page = await fetchConversationThread(conversationId);
      if (mine !== threadSeq.current) return;
      setMessages(page?.items ?? []);
      setOlderCursor(page?.nextCursor ?? null);
    } finally {
      if (mine === threadSeq.current) setThreadLoading(false);
    }
  }, []);

  // Trocar de conversa limpa a tela e busca as mensagens da nova (feito no
  // clique, não num efeito: assim não há renderização com a conversa errada).
  function openConversation(row: ConversationRowDTO) {
    if (row.id === selectedId) return;
    selectedIdRef.current = row.id;
    setSelectedId(row.id);
    setSelectedSnapshot(row);
    setSelectedContact(row.contact);
    setMessages([]);
    setPrivateNotes([]);
    setComposerMode("message");
    messageDraft.current = "";
    noteDraft.current = "";
    if (inputRef.current) inputRef.current.value = "";
    setOlderCursor(null);
    setSendOptions([]);
    setChosenConnection("");
    setSendError(null);
    setCustomerDetail(null);
    loadThread(row.id);
    fetchConversationSendOptions(row.id).then((opts) => {
      if (selectedIdRef.current === row.id) setSendOptions(opts); // ignora se já trocou de conversa
    });
  }

  async function loadOlder() {
    if (!selectedId || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const el = bodyRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await fetchConversationThread(selectedId, olderCursor);
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
  const timeline = useMemo(() => [
    ...messages.map((message) => ({ kind: "message" as const, time: message.time, message })),
    ...privateNotes.map((note) => ({ kind: "note" as const, time: note.createdAt, note })),
  ].sort((a, b) => a.time.localeCompare(b.time)), [messages, privateNotes]);
  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    fetchPrivateNotes(selectedId).then((notes) => { if (live) setPrivateNotes(notes); });
    return () => { live = false; };
  }, [selectedId]);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId, lastMessageId, privateNotes.length]);

  // ── Atualização periódica (no lugar de tempo real) ────────────────────────
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        // Lista: só se o usuário não está buscando nem paginou (senão apagaria o que ele carregou).
        if (!search.trim() && pagesLoaded.current === 1 && filtersApplied === 0) {
          const { page } = await fetchConversations();
          setRows(page.items);
          setNextCursor(page.nextCursor);
        }
        if (selectedId) {
          const page = await fetchConversationThread(selectedId);
          if (page) setMessages((prev) => mergeMessages(prev, page.items));
        }
      } catch {
        // falha de rede momentânea: tenta de novo no próximo ciclo
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [search, selectedId, filtersApplied]);

  async function refreshNow() {
    if (!search.trim() && pagesLoaded.current === 1 && filtersApplied === 0) {
      const { page } = await fetchConversations();
      setRows(page.items);
      setNextCursor(page.nextCursor);
    }
    if (selectedId) {
      const page = await fetchConversationThread(selectedId);
      if (page) setMessages((prev) => mergeMessages(prev, page.items));
    }
  }

  async function openCustomerPanel() {
    if (!activeContact) return;
    setCustomerPanelOpen(true);
    setCustomerDetail(null);
    setCustomerDetailLoading(true);
    try {
      const [detail, history] = await Promise.all([fetchContactDetail(activeContact.id), selectedId ? fetchConversationEvents(selectedId) : Promise.resolve([])]);
      setCustomerDetail(detail);
      setEvents(history);
      setTagDraft(detail?.contact.tags.join(", ") ?? "");
    } finally {
      setCustomerDetailLoading(false);
    }
  }

  const selectedContactId = selectedContact?.id;
  useEffect(() => {
    if (!selectedId || !selectedContactId || !customerPanelOpen) return;
    let live = true;
    Promise.all([fetchContactDetail(selectedContactId), fetchConversationEvents(selectedId)]).then(([detail, history]) => {
      if (!live) return;
      setCustomerDetail(detail);
      setEvents(history);
      setTagDraft(detail?.contact.tags.join(", ") ?? "");
      setCustomerDetailLoading(false);
    });
    return () => { live = false; };
  }, [selectedId, selectedContactId, customerPanelOpen]);

  async function handleSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeContact || !inputRef.current) return;
    const text = inputRef.current.value.trim();
    if (!text) return;
    if (composerMode === "private") {
      if (!selectedId) return;
      setSending(true);
      try {
        const result = await addPrivateNote(selectedId, text);
        if (!result.ok) { setSendError(result.error); return; }
        setPrivateNotes((notes) => [...notes, result.note]);
        inputRef.current.value = "";
        noteDraft.current = "";
        setSendError(null);
      } finally { setSending(false); }
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const conversationId = selectedId;
      if (!conversationId) return;
      const result = await sendMessage(conversationId, text);
      if (!result.ok) {
        // Nada foi enviado nem gravado: o texto continua no campo para tentar de novo.
        setSendError(result.error);
        return;
      }
      inputRef.current.value = "";
      messageDraft.current = "";
      if (result.status === "failed") {
        setSendError(`A mensagem foi registrada, mas o canal recusou o envio${result.error ? `: ${result.error}` : ""}.`);
      }
      await refreshNow();
      // O envio pode ter criado o vínculo com o canal (primeira conversa).
      setSendOptions(await fetchConversationSendOptions(conversationId));
    } finally {
      setSending(false);
    }
  }

  function switchComposerMode(next: "message" | "private") {
    if (next === composerMode) return;
    if (composerMode === "message") messageDraft.current = inputRef.current?.value ?? "";
    else noteDraft.current = inputRef.current?.value ?? "";
    if (inputRef.current) inputRef.current.value = next === "message" ? messageDraft.current : noteDraft.current;
    setComposerMode(next);
    setTemplatesOpen(false);
    setSendError(null);
  }

  async function retryMessage(messageId: string) {
    if (!selectedId) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await retryFailedMessage(selectedId, messageId);
      if (!result.ok) setSendError(result.error);
      else if (result.status === "failed") setSendError(result.error || "O canal recusou novamente o envio.");
      await refreshNow();
    } finally {
      setSending(false);
    }
  }

  // Canais prontos para enviar agora (conectados). Se houver mais de um, o
  // atendente escolhe; se não houver nenhum, o envio fica bloqueado.
  const usableChannels = sendOptions.filter((o) => o.connected);
  const PROVIDER_NAME: Record<SendOptionDTO["provider"], string> = {
    WHATSAPP_EVOLUTION: "WhatsApp",
    WHATSAPP_AZAP: "WhatsApp · AZAP",
    WHATSAPP_CLOUD: "WhatsApp · Oficial",
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
            <div className="conversation-filter-trigger">
              <button type="button" className={`btn small ${filtersApplied ? "primary" : ""}`} onClick={() => setFiltersOpen((open) => !open)}>
                Filtros{filtersApplied ? ` (${filtersApplied})` : ""}
              </button>
              {filtersApplied > 0 && <button type="button" className="btn small ghost" onClick={() => setFilters({ ownerId: "", team: "", connectionId: "", provider: "", tag: "", stageId: "", status: "OPEN", from: "", to: "" })}>Limpar</button>}
            </div>
            {filtersOpen && (
              <div className="conversation-filters">
                <label>Atendente<select value={filters.ownerId} onChange={(e) => setFilters((f) => ({ ...f, ownerId: e.target.value }))}><option value="">Todos</option><option value="unassigned">Sem atendente</option>{team.filter((member) => member.isActive).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                <label>Equipe<select value={filters.team} onChange={(e) => setFilters((f) => ({ ...f, team: e.target.value }))}><option value="">Todas</option>{[...new Set(team.map((member) => member.team))].sort().map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                <label>Canal<select value={filters.provider} onChange={(e) => setFilters((f) => ({ ...f, provider: e.target.value, connectionId: "" }))}><option value="">Todos</option><option value="WHATSAPP_EVOLUTION">WhatsApp · Evolution</option><option value="WHATSAPP_AZAP">WhatsApp · AZAP</option><option value="WHATSAPP_CLOUD">WhatsApp · Oficial</option><option value="INSTAGRAM">Instagram</option><option value="EMAIL">E-mail</option></select></label>
                <label>Instância<select value={filters.connectionId} onChange={(e) => setFilters((f) => ({ ...f, connectionId: e.target.value }))}><option value="">Todas</option>{connections.filter((connection) => !filters.provider || connection.provider === filters.provider).map((connection) => <option key={connection.id} value={connection.id}>{PROVIDER_NAME[connection.provider]} · {connection.label}</option>)}</select></label>
                <label>Tag<select value={filters.tag} onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}><option value="">Todas</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
                <label>Etapa<select value={filters.stageId} onChange={(e) => setFilters((f) => ({ ...f, stageId: e.target.value }))}><option value="">Todas</option>{pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => <option key={stage.id} value={stage.id}>{pipeline.name} · {stage.label}</option>))}</select></label>
                <label>Status<select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}><option value="OPEN">Abertas</option><option value="CLOSED">Finalizadas</option><option value="ALL">Todas</option></select></label>
                <label>De<input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></label>
                <label>Até<input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></label>
              </div>
            )}
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
                {rows.map((row) => {
                  const { contact: c, lastText, lastTime } = row;
                  const owner = ownerOf(row.ownerId);
                  const channel = row.channel;
                  return (
                    <div
                      key={row.id}
                      className={`convo-item ${selectedId === row.id ? "active" : ""}`}
                      onClick={() => openConversation(row)}
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
                          <span className={`conversation-status ${row.status === "CLOSED" ? "closed" : ""}`}>{row.status === "OPEN" ? "Aberta" : "Finalizada"}</span>
                          {currentUserRole === "ADMIN" && (
                            <span className="convo-owner">· {owner?.name ?? "Sem atendente"}</span>
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
                  <div className="conversation-head-meta">
                    <div className="conversation-channel-summary">
                      <span>CANAL DA CONVERSA</span>
                      <ChannelBadge channel={activeChannel} />
                      {activeChannel ? (
                        <small>{`Instância/conexão: ${activeChannel.label}`}</small>
                      ) : usableChannels.length > 0 ? (
                        <label className="conversation-channel-picker">
                          <small>Selecione a instância que deve atender este histórico:</small>
                          <select value="" disabled={linkingChannel} onChange={(event) => chooseConversationChannel(event.target.value)} aria-label="Vincular canal ao atendimento">
                            <option value="">{linkingChannel ? "Vinculando canal..." : "Selecionar canal/instância"}</option>
                            {usableChannels.map((option) => <option key={option.connectionId} value={option.connectionId}>{PROVIDER_LABEL[option.provider]} · {option.label}{option.existing ? "" : " (iniciar conversa)"}</option>)}
                          </select>
                        </label>
                      ) : (
                        <small>Sem instância elegível. Conecte um canal ou cadastre telefone/e-mail no contato.</small>
                      )}
                      {activeChannel?.provider === "WHATSAPP_CLOUD" && <small className={cloudWindowOpen ? "conversation-window-open" : "conversation-window-closed"}>{cloudWindowOpen ? `Janela 24h aberta até ${new Date(cloudWindowEnds!).toLocaleString("pt-BR")}` : "Janela 24h encerrada · somente template aprovado"}</small>}
                    </div>
                    {currentUserRole === "ADMIN" ? (
                      <label className="conversation-assignment">
                        <span>ATENDENTE</span>
                        <div>
                          <span className="avatar" style={{ background: activeOwner?.color ?? "#94a3b8" }}>{activeOwner ? initials(activeOwner.name) : "?"}</span>
                          <select value={activeRow?.ownerId ?? ""} onChange={(event) => changeAssignee(event.target.value || null, activeRow?.ownerId ? "transfer" : "assign")} aria-label="Definir atendente da conversa">
                            <option value="">Sem atendente</option>
                            {team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                          </select>
                        </div>
                      </label>
                    ) : (
                      <div className="conversation-assignment readonly"><span>ATENDENTE</span><div><span className="avatar" style={{ background: activeOwner?.color ?? "#94a3b8" }}>{activeOwner ? initials(activeOwner.name) : "?"}</span><strong>{activeOwner?.name ?? "Sem atendente"}</strong></div></div>
                    )}
                  </div>
                  <div className="conversation-actions">
                    {activeRow?.status === "OPEN" ? (
                      <button type="button" className="btn small" onClick={() => changeStatus("CLOSED")}>Finalizar</button>
                    ) : (
                      <button type="button" className="btn small primary" onClick={() => changeStatus("OPEN")}>Reabrir</button>
                    )}
                    {activeRow?.ownerId !== currentUserId && <button type="button" className="btn small" onClick={() => changeAssignee(null, "claim")}>Assumir</button>}
                    <button type="button" className="btn small" onClick={openCustomerPanel}>Ficha</button>
                  </div>
                </div>
                <div className="thread-body" ref={bodyRef}>
                  {olderCursor && (
                    <div style={{ textAlign: "center", marginBottom: 8 }}>
                      <button className="btn small ghost" onClick={loadOlder} disabled={loadingOlder}>
                        {loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}
                      </button>
                    </div>
                  )}
                  {timeline.length === 0 ? (
                    <div className="thread-empty">
                      <Icon.empty />
                      <div>{threadLoading ? "Carregando…" : "Nenhuma mensagem ainda. Diga olá!"}</div>
                    </div>
                  ) : (
                    timeline.map((item) => item.kind === "note" ? (
                      <div key={`note-${item.note.id}`} className="private-note"><strong>Nota privada · só você vê</strong><div>{item.note.text}</div><small>{fmtTime(item.note.createdAt)}</small></div>
                    ) : (
                      <div key={item.message.id} className={`bubble-row ${item.message.direction === "out" ? "me" : "them"}`}>
                        <div className="bubble">
                          {item.message.text}
                          <span className="time">{fmtTime(item.message.time)}</span>
                          {item.message.status === "failed" && <button type="button" className="btn small" disabled={sending || activeRow?.status === "CLOSED" || cloudWindowClosed} onClick={() => retryMessage(item.message.id)}>Tentar novamente</button>}
                          {item.message.status === "failed" && (
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#fecaca", marginTop: 2 }}>
                              ⚠ Não foi entregue — o canal recusou o envio
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {usableChannels.length === 0 || activeRow?.status === "CLOSED" || cloudWindowClosed ? (
                  <div
                    role="alert"
                    style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "var(--orange)", background: "var(--orange-soft, #fff7ed)", borderTop: "1px solid var(--border-soft)" }}
                  >
                    {activeRow?.status === "CLOSED" ? "Este atendimento foi finalizado. Reabra-o para enviar uma nova mensagem." : cloudWindowClosed ? "Janela de 24h encerrada para esta instância oficial. Texto livre bloqueado; para retomar, envie um template aprovado pela Meta. Os 'Modelos' locais não são templates oficiais." : noChannelReason}
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
                <div className="composer-modes"><button type="button" className={composerMode === "message" ? "active" : ""} onClick={() => switchComposerMode("message")}>Mensagem ao cliente</button><button type="button" className={composerMode === "private" ? "active" : ""} onClick={() => switchComposerMode("private")}>Nota privada · só eu</button></div>
                <form className={`thread-input ${composerMode === "private" ? "private-composer" : ""}`} onSubmit={handleSend} style={{ position: "relative" }}>
                  {composerMode === "message" && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setTemplatesOpen((v) => !v)}
                  >
                    Modelos
                  </button>
                  )}
                  <input
                    ref={inputRef}
                    onChange={(event) => { if (composerMode === "private") noteDraft.current = event.target.value; else messageDraft.current = event.target.value; }}
                    placeholder={composerMode === "private" ? "Escreva uma anotação pessoal (não será enviada ao cliente)..." : usableChannels.length === 0 ? "Sem canal para enviar" : "Escreva uma mensagem..."}
                    autoComplete="off"
                    disabled={composerMode === "message" && (usableChannels.length === 0 || activeRow?.status === "CLOSED" || cloudWindowClosed)}
                  />
                  <button type="submit" className="btn primary icon-only" disabled={sending || (composerMode === "message" && (usableChannels.length === 0 || activeRow?.status === "CLOSED" || cloudWindowClosed))}><Icon.send /></button>

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
                    <span>Responsável: {activeOwner?.name ?? "Não definido"}</span>
                  </div>
                  <section className="context-section">
                    <div className="context-section-title">Canal e instância</div>
                    {linkedChannels.length > 0 ? linkedChannels.map((channel) => (
                      <div key={channel.connectionId} className="context-channel">
                        <strong>{PROVIDER_NAME[channel.provider]}</strong>
                        <span>{channel.label} · {channel.connected ? "conectado" : "desconectado"}</span>
                      </div>
                    )) : activeChannel ? (
                      <div className="context-channel"><strong>{PROVIDER_LABEL[activeChannel.provider]}</strong><span>{activeChannel.label}</span></div>
                    ) : <span className="muted">Nenhum canal vinculado. Esta conversa foi criada sem registrar WhatsApp, Instagram ou e-mail.</span>}
                  </section>
                  <div className="context-tags">
                    {customerDetail.contact.tags.length ? customerDetail.contact.tags.map((tag) => <span key={tag} className="tag">{tag}</span>) : <span className="muted">Sem tags</span>}
                  </div>
                  <form className="conversation-tag-editor" onSubmit={async (event) => {
                    event.preventDefault();
                    if (!selectedId) return;
                    const result = await updateConversationTags(selectedId, tagDraft.split(","));
                    if (result.ok) {
                      setCustomerDetail((detail) => detail ? { ...detail, contact: { ...detail.contact, tags: result.tags ?? [] } } : detail);
                      setEvents(await fetchConversationEvents(selectedId));
                    }
                  }}><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="Tags separadas por vírgula" /><button className="btn small" type="submit">Salvar tags</button></form>
                  <div className="context-stat-grid">
                    <div><span>Oportunidades</span><strong>{customerDetail.opportunities.length}</strong></div>
                    <div><span>Em negociação</span><strong>{fmtMoney(customerDetail.opportunities.reduce((sum, opportunity) => sum + opportunity.value, 0))}</strong></div>
                  </div>
                  <section className="context-section">
                    <div className="context-section-title">Oportunidades</div>
                    {customerDetail.opportunities.length === 0 ? <span className="muted">Nenhuma oportunidade cadastrada.</span> : customerDetail.opportunities.slice(0, 4).map((opportunity) => (
                      <div key={opportunity.id} className="context-opportunity">
                        <strong>{opportunity.title}</strong>
                        <span>{pipelines.find((item) => item.id === opportunity.pipelineId)?.name ?? "Pipeline não encontrado"} · {pipelines.flatMap((item) => item.stages).find((stage) => stage.id === opportunity.stageId)?.label ?? "Etapa não encontrada"}</span>
                        <span>{fmtMoney(opportunity.value)}{opportunity.expectedClose ? ` · ${fmtDate(opportunity.expectedClose)}` : ""}</span>
                      </div>
                    ))}
                  </section>
                  <section className="context-section">
                    <div className="context-section-title">Próximas ações</div>
                    {customerDetail.activities.length === 0 ? <span className="muted">Nenhuma atividade planejada.</span> : customerDetail.activities.slice(0, 3).map((activity) => (
                      <div key={activity.id} className={`context-activity ${activity.done ? "done" : ""}`}>
                        <strong>{activity.title}</strong>
                        <span>{fmtDate(activity.dueAt)} · {activity.done ? "concluída" : "pendente"}</span>
                      </div>
                    ))}
                  </section>
                  <div className="context-quick-actions">
                    <button type="button" className="btn small" onClick={() => setQuickAction("task")}>Criar follow-up</button>
                    <button type="button" className="btn small" onClick={() => setQuickAction("opportunity")}>Nova oportunidade</button>
                  </div>
                  <section className="context-section">
                    <div className="context-section-title">Notas</div>
                    <p>{customerDetail.contact.notes || "Nenhuma nota cadastrada."}</p>
                  </section>
                  <section className="context-section">
                    <div className="context-section-title">Histórico do atendimento</div>
                    {events.length === 0 ? <span className="muted">Nenhuma ação registrada ainda.</span> : events.map((event) => (
                      <div key={event.id} className="conversation-event"><strong>{event.detail}</strong><span>{event.actorName || "Sistema"} · {fmtDate(event.createdAt)} {fmtTime(event.createdAt)}</span></div>
                    ))}
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
      {quickAction && activeContact && (
        <ConversationQuickActionModal
          kind={quickAction}
          contact={activeContact}
          team={team}
          pipelines={pipelines}
          defaultPipeline={defaultPipeline}
          busy={quickActionBusy}
          onClose={() => setQuickAction(null)}
          onSubmit={async (form) => {
            setQuickActionBusy(true);
            try {
              if (quickAction === "task") {
                await createActivity({
                  title: String(form.get("title") || ""),
                  type: String(form.get("type") || "TASK") as ActivityInput["type"],
                  notes: String(form.get("notes") || ""),
                  dueAt: new Date(String(form.get("dueAt") || "")).toISOString(),
                  contactId: activeContact.id,
                  opportunityId: null,
                  assigneeId: String(form.get("assigneeId") || "") || activeContact.ownerId || null,
                });
              } else {
                const pipelineId = String(form.get("pipelineId") || "");
                const pipeline = pipelines.find((item) => item.id === pipelineId);
                await createOpportunity({
                  title: String(form.get("title") || ""),
                  value: Number(form.get("value")) || 0,
                  tags: String(form.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
                  contactId: activeContact.id,
                  pipelineId,
                  stageId: String(form.get("stageId") || pipeline?.stages[0]?.id || ""),
                  ownerId: String(form.get("assigneeId") || "") || activeContact.ownerId || null,
                  expectedClose: String(form.get("expectedClose") || "") || null,
                });
              }
              setQuickAction(null);
              await openCustomerPanel();
              router.refresh();
            } finally {
              setQuickActionBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

function ConversationQuickActionModal({
  kind, contact, team, pipelines, defaultPipeline, busy, onClose, onSubmit,
}: {
  kind: "task" | "opportunity";
  contact: ContactDTO;
  team: TeamMemberDTO[];
  pipelines: PipelineDTO[];
  defaultPipeline: PipelineDTO | undefined;
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const [pipelineId, setPipelineId] = useState(defaultPipeline?.id ?? "");
  const pipeline = useMemo(() => pipelines.find((item) => item.id === pipelineId), [pipelines, pipelineId]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>{kind === "task" ? "Criar follow-up" : "Nova oportunidade"}</h2><button className="close-x" onClick={onClose}><Icon.close /></button></div>
        <form onSubmit={async (event) => { event.preventDefault(); await onSubmit(new FormData(event.currentTarget)); }}>
          <div className="modal-body">
            <div className="quick-contact"><span className="avatar" style={{ background: colorFor(contact.name) }}>{initials(contact.name)}</span><div><span>Contato</span><strong>{contact.name}</strong></div></div>
            <div className="field"><label>{kind === "task" ? "Follow-up *" : "Título da oportunidade *"}</label><input name="title" required autoFocus placeholder={kind === "task" ? "Ex: Retomar proposta" : "Ex: Plano anual"} /></div>
            {kind === "task" ? <>
              <div className="field-row"><div className="field"><label>Tipo</label><select name="type"><option value="TASK">Tarefa</option><option value="CALL">Ligação</option><option value="MEETING">Reunião</option></select></div><div className="field"><label>Quando *</label><input name="dueAt" type="datetime-local" required /></div></div>
              <div className="field"><label>Notas</label><textarea name="notes" placeholder="Contexto para o próximo atendimento" /></div>
            </> : <>
              <div className="field-row"><div className="field"><label>Valor (R$)</label><input name="value" type="number" min={0} step={1} /></div><div className="field"><label>Previsão</label><input name="expectedClose" type="date" /></div></div>
              <div className="field"><label>Pipeline</label><select name="pipelineId" value={pipelineId} onChange={(event) => setPipelineId(event.target.value)}>{pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <div className="field"><label>Etapa</label><select name="stageId">{pipeline?.stages.slice().sort((a, b) => a.order - b.order).map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></div>
              <div className="field"><label>Tags</label><input name="tags" placeholder="Urgente, indicação..." /></div>
            </>}
            <div className="field"><label>Responsável</label><select name="assigneeId"><option value="">{contact.ownerId ? "Responsável do contato" : "Sem responsável"}</option>{team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div>
          </div>
          <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="submit" className="btn primary" disabled={busy}>{kind === "task" ? "Criar follow-up" : "Criar oportunidade"}</button></div>
        </form>
      </div>
    </div>
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
