"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { initials, fmtMoney } from "@/lib/format";
import type { PipelineDTO, TeamMemberDTO } from "@/lib/types";

// Números do painel, já somados no banco (ver getDashboardAggregates em
// lib/queries.ts). A tela não recebe mais a lista de negócios — só os totais.
export type DashboardData = {
  stageTotals: { stageId: string; count: number; sum: number }[];
  monthly: { month: string; stageId: string; sum: number }[];
  ownerTotals: { ownerId: string | null; sum: number }[];
  stageSpeed: { stageId: string; avgMs: number; count: number }[];
  attention: { overdueActivities: number; dueThisWeek: number; inactiveContacts: number };
  service: { inbound: number; answered: number; firstResponseMs: number | null; slaRate: number; delivered: number; read: number; failed: number };
  channels: { connectionId: string | null; label: string; provider: string; inbound: number; outbound: number; delivered: number; read: number; failed: number }[];
  campaigns: { id: string; name: string; status: string; total: number; sent: number; responded: number; failed: number }[];
};

const MONTH_LABELS = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]}/${String(y).slice(2)}`;
}

function durationLabel(ms: number | null) {
  if (ms === null) return "—";
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} h`;
}

export function DashboardView({
  pipelines,
  data,
  team,
}: {
  pipelines: PipelineDTO[];
  data: DashboardData;
  team: TeamMemberDTO[];
}) {
  // Classify every stage across every pipeline as won / lost / open,
  // using the seeded label convention (see known limitation in README).
  const stageKind = useMemo(() => {
    const map = new Map<string, "won" | "lost" | "open">();
    for (const p of pipelines) {
      for (const s of p.stages) {
        const label = s.label.trim().toLowerCase();
        map.set(s.id, label === "ganho" ? "won" : label === "perdido" ? "lost" : "open");
      }
    }
    return map;
  }, [pipelines]);

  const totals = useMemo(() => {
    const t = { all: { count: 0, sum: 0 }, won: { count: 0, sum: 0 }, lost: { count: 0, sum: 0 }, open: { count: 0, sum: 0 } };
    for (const s of data.stageTotals) {
      const kind = stageKind.get(s.stageId) ?? "open";
      t[kind].count += s.count;
      t[kind].sum += s.sum;
      t.all.count += s.count;
      t.all.sum += s.sum;
    }
    return t;
  }, [data.stageTotals, stageKind]);

  const totalCount = totals.all.count;
  const wonCount = totals.won.count;
  const lostCount = totals.lost.count;
  const openCount = totals.open.count;
  const totalAllValue = totals.all.sum;
  const totalWonValue = totals.won.sum;
  const totalLostValue = totals.lost.sum;
  const totalOpenValue = totals.open.sum;
  const resolvedCount = wonCount + lostCount;
  const conversionRate = resolvedCount > 0 ? (wonCount / resolvedCount) * 100 : 0;
  const averageTicket = wonCount > 0 ? totalWonValue / wonCount : 0;

  // ---------- Monthly stacked bars (open vs won, by createdAt month) ----------
  const monthly = useMemo(() => {
    const buckets = new Map<string, { open: number; won: number }>();
    for (const r of data.monthly) {
      const kind = stageKind.get(r.stageId);
      if (kind === "lost") continue;
      const entry = buckets.get(r.month) ?? { open: 0, won: 0 };
      if (kind === "won") entry.won += r.sum;
      else entry.open += r.sum;
      buckets.set(r.month, entry);
    }
    return [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, v]) => ({ key, label: monthLabel(key), ...v, total: v.open + v.won }));
  }, [data.monthly, stageKind]);

  const maxMonthTotal = Math.max(1, ...monthly.map((m) => m.total));

  // ---------- Donut: value by team member ----------
  const byOwner = useMemo(() => {
    const rows = data.ownerTotals
      .map(({ ownerId, sum }) => {
        const member = team.find((m) => m.id === ownerId);
        return {
          id: ownerId ?? "__none__",
          name: member?.name ?? "Sem responsável",
          color: member?.color ?? "#94a3b8",
          value: sum,
        };
      })
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    return { rows, total };
  }, [data.ownerTotals, team]);

  // ---------- Tempo médio por etapa (velocity) ----------
  // Só passagens já encerradas entram na média (feito no SQL) — uma etapa
  // ainda em aberto distorceria o tempo "normal" de permanência.
  const stageSpeed = useMemo(() => {
    const stageLabel = new Map<string, string>();
    const stageOrder = new Map<string, number>();
    for (const p of pipelines) {
      for (const s of p.stages) {
        stageLabel.set(s.id, s.label);
        stageOrder.set(s.id, s.order);
      }
    }
    const rows = data.stageSpeed
      .map((r) => ({
        stageId: r.stageId,
        label: stageLabel.get(r.stageId) ?? "Etapa removida",
        order: stageOrder.get(r.stageId) ?? 0,
        avgDays: r.avgMs / 86400000,
      }))
      .sort((a, b) => a.order - b.order);
    const maxDays = Math.max(1, ...rows.map((r) => r.avgDays));
    return { rows, maxDays };
  }, [pipelines, data.stageSpeed]);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">Receita, conversão e saúde do funil em um só lugar</div>
        </div>
      </div>

      <div className="content">
        <section className="dashboard-hero" aria-label="Resumo do funil">
          <div>
            <span className="eyebrow">PANORAMA COMERCIAL</span>
            <h2>{totalCount > 0 ? `${conversionRate.toFixed(0)}% de conversão` : "Seu funil começa aqui"}</h2>
            <p>
              {totalCount > 0
                ? `${wonCount} negócios ganhos de ${resolvedCount || totalCount} já definidos.`
                : "Cadastre contatos e oportunidades para acompanhar os indicadores da clínica."}
            </p>
          </div>
          <div className="dashboard-hero-metrics">
            <div><span>Ticket médio</span><strong>{fmtMoney(averageTicket)}</strong></div>
            <div><span>Carteira ativa</span><strong>{fmtMoney(totalOpenValue)}</strong></div>
          </div>
        </section>

        <div className="dash-stats">
          <StatTile
            label="Total negócios"
            value={fmtMoney(totalAllValue)}
            delta={`${totalCount.toLocaleString("pt-BR")} negócios`}
            color="var(--text-soft)"
            bg="var(--slate-soft)"
            icon={<Icon.dashboard />}
          />
          <StatTile
            label="Total ganhos"
            value={fmtMoney(totalWonValue)}
            delta={`${wonCount.toLocaleString("pt-BR")} negócios fechados`}
            color="var(--green)"
            bg="var(--green-soft)"
            icon={<Icon.up />}
          />
          <StatTile
            label="Total perdidos"
            value={fmtMoney(totalLostValue)}
            delta={`${lostCount.toLocaleString("pt-BR")} negócios perdidos`}
            color="var(--red)"
            bg="var(--red-soft)"
            icon={<Icon.down />}
          />
          <StatTile
            label="Total em aberto"
            value={fmtMoney(totalOpenValue)}
            delta={`${openCount.toLocaleString("pt-BR")} negócios em andamento`}
            color="var(--primary)"
            bg="var(--primary-soft)"
            icon={<Icon.pipeline />}
          />
        </div>

        <section className="attention-center" aria-label="Prioridades comerciais">
          <div className="attention-copy">
            <span className="eyebrow">CENTRAL DE PRIORIDADES</span>
            <h2>O que pede ação agora</h2>
            <p>Use estes atalhos para destravar negociações e manter os follow-ups em dia.</p>
          </div>
          <div className="attention-actions">
            <a href="/activities" className={`attention-card ${data.attention.overdueActivities ? "urgent" : ""}`}>
              <span>Tarefas atrasadas</span>
              <strong>{data.attention.overdueActivities}</strong>
              <small>Ver follow-ups</small>
            </a>
            <a href="/pipeline" className="attention-card">
              <span>Fechamentos em 7 dias</span>
              <strong>{data.attention.dueThisWeek}</strong>
              <small>Revisar previsões</small>
            </a>
            <a href="/conversations" className="attention-card">
              <span>Contatos sem interação</span>
              <strong>{data.attention.inactiveContacts}</strong>
              <small>Retomar conversas</small>
            </a>
          </div>
        </section>

        <section className="chart-card" aria-label="Qualidade do atendimento" style={{ marginBottom: 18 }}>
          <div className="chart-title">Qualidade do atendimento</div>
          <div className="chart-sub">Últimos 30 dias · SLA considerado: primeira resposta em até 15 minutos.</div>
          <div className="dash-stats" style={{ marginTop: 16 }}>
            <StatTile label="1ª resposta média" value={durationLabel(data.service.firstResponseMs)} delta={`${data.service.answered}/${data.service.inbound} conversas respondidas`} color="var(--primary)" bg="var(--primary-soft)" icon={<Icon.chat />} />
            <StatTile label="SLA cumprido" value={`${data.service.slaRate.toFixed(0)}%`} delta="respostas em até 15 min" color="var(--green)" bg="var(--green-soft)" icon={<Icon.up />} />
            <StatTile label="Mensagens lidas" value={String(data.service.read)} delta={`${data.service.delivered} entregues`} color="var(--text-soft)" bg="var(--slate-soft)" icon={<Icon.dashboard />} />
            <StatTile label="Falhas de envio" value={String(data.service.failed)} delta="confira a conexão/remetente" color="var(--red)" bg="var(--red-soft)" icon={<Icon.down />} />
          </div>
        </section>

        <div className="charts-row">
          <div className="chart-card">
            <div className="chart-title">Dados mensais</div>
            <div className="chart-sub">Visualização por valor dos negócios</div>
            {monthly.length === 0 ? (
              <div className="empty-state"><Icon.empty /><div>Sem negócios registrados ainda</div></div>
            ) : (
              <MonthlyBarChart data={monthly} max={maxMonthTotal} />
            )}
            <div className="legend-row">
              <div className="legend-item"><span className="legend-dot" style={{ background: "var(--blue)" }} /> Em aberto</div>
              <div className="legend-item"><span className="legend-dot" style={{ background: "var(--green)" }} /> Ganho</div>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-title">Percentual por atendente</div>
            <div className="chart-sub">Valor total dos negócios atribuídos</div>
            {byOwner.rows.length === 0 ? (
              <div className="empty-state"><Icon.empty /><div>Nenhum negócio atribuído</div></div>
            ) : (
              <DonutChart rows={byOwner.rows} total={byOwner.total} />
            )}
          </div>
        </div>

        <div className="charts-row" style={{ gridTemplateColumns: "1fr" }}>
          <div className="chart-card">
            <div className="chart-title">Tempo médio por etapa</div>
            <div className="chart-sub">Velocity do funil — quanto tempo os negócios levam em cada etapa até avançar</div>
            {stageSpeed.rows.length === 0 ? (
              <div className="empty-state"><Icon.empty /><div>Ainda sem etapas concluídas pra calcular velocity</div></div>
            ) : (
              <StageSpeedBars rows={stageSpeed.rows} max={stageSpeed.maxDays} />
            )}
          </div>
        </div>

        <div className="charts-row" style={{ marginTop: 18 }}>
          <div className="chart-card">
            <div className="chart-title">Atendimento por instância</div>
            <div className="chart-sub">Volume e qualidade por canal conectado · últimos 30 dias</div>
            {data.channels.length === 0 ? <div className="empty-state"><Icon.empty /><div>Sem mensagens de canais conectados no período</div></div> : (
              <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Instância</th><th>Canal</th><th>Recebidas</th><th>Enviadas</th><th>Lidas</th><th>Falhas</th></tr></thead><tbody>{data.channels.map((channel) => <tr key={channel.connectionId ?? "legacy"}><td>{channel.label}</td><td className="muted">{channel.provider}</td><td>{channel.inbound}</td><td>{channel.outbound}</td><td>{channel.read}</td><td>{channel.failed}</td></tr>)}</tbody></table></div>
            )}
          </div>
          <div className="chart-card">
            <div className="chart-title">Campanhas recentes</div>
            <div className="chart-sub">Envios, respostas e falhas por campanha</div>
            {data.campaigns.length === 0 ? <div className="empty-state"><Icon.empty /><div>Nenhuma campanha criada ainda</div></div> : (
              <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Campanha</th><th>Enviados</th><th>Respostas</th><th>Falhas</th></tr></thead><tbody>{data.campaigns.map((campaign) => <tr key={campaign.id}><td>{campaign.name}<div className="muted" style={{ fontSize: 11 }}>{campaign.status} · {campaign.total} contatos</div></td><td>{campaign.sent}</td><td>{campaign.responded}</td><td>{campaign.failed}</td></tr>)}</tbody></table></div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function StatTile({
  label,
  value,
  delta,
  color,
  bg,
  icon,
}: {
  label: string;
  value: string;
  delta: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="dash-stat">
      <div className="top-row">
        <span className="label">{label}</span>
        <span className="icon-badge" style={{ background: bg, color }}>{icon}</span>
      </div>
      <div className="value">{value}</div>
      <div className="delta">{delta}</div>
    </div>
  );
}

function MonthlyBarChart({
  data,
  max,
}: {
  data: { key: string; label: string; open: number; won: number; total: number }[];
  max: number;
}) {
  const [hover, setHover] = useState<{ x: number; y: number; item: (typeof data)[number] } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div style={{ position: "relative" }} ref={containerRef}>
      <div className="bar-chart">
        {data.map((m) => {
          const openH = (m.open / max) * 100;
          const wonH = (m.won / max) * 100;
          return (
            <div key={m.key} className="bar-col">
              <div
                className="bar-stack"
                style={{ height: `${Math.max(openH + wonH, 2)}%` }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const base = containerRef.current?.getBoundingClientRect();
                  setHover({ x: rect.left + rect.width / 2 - (base?.left ?? 0), y: rect.top - (base?.top ?? 0), item: m });
                }}
                onMouseLeave={() => setHover(null)}
              >
                {wonH > 0 && <div className="bar-seg" style={{ height: `${(wonH / (openH + wonH || 1)) * 100}%`, background: "var(--green)" }} />}
                {openH > 0 && <div className="bar-seg" style={{ height: `${(openH / (openH + wonH || 1)) * 100}%`, background: "var(--blue)" }} />}
              </div>
              <div className="bar-label">{m.label}</div>
            </div>
          );
        })}
      </div>
      {hover && (
        <div className="chart-tooltip" style={{ left: hover.x - (document.querySelector(".chart-card")?.getBoundingClientRect().left ?? 0), top: hover.y - (document.querySelector(".chart-card")?.getBoundingClientRect().top ?? 0) }}>
          <div className="row"><span className="dot" style={{ background: "var(--blue)" }} /> Aberto: {fmtMoney(hover.item.open)}</div>
          <div className="row"><span className="dot" style={{ background: "var(--green)" }} /> Ganho: {fmtMoney(hover.item.won)}</div>
        </div>
      )}
    </div>
  );
}

function StageSpeedBars({
  rows,
  max,
}: {
  rows: { stageId: string; label: string; avgDays: number }[];
  max: number;
}) {
  return (
    <div className="hbar-list">
      {rows.map((r) => (
        <div key={r.stageId} className="hbar-row">
          <span className="hbar-label" title={r.label}>{r.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${Math.max((r.avgDays / max) * 100, 2)}%`, background: "var(--primary)" }} />
          </span>
          <span className="hbar-value">{r.avgDays < 1 ? "< 1 dia" : `${r.avgDays.toFixed(1)} dias`}</span>
        </div>
      ))}
    </div>
  );
}

function DonutChart({
  rows,
  total,
}: {
  rows: { id: string; name: string; color: string; value: number }[];
  total: number;
}) {
  const size = 150;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const top = rows.slice(0, 5);
  const topSum = top.reduce((s, r) => s + r.value, 0);
  const otherValue = total - topSum;

  const slices = otherValue > 0.01 ? [...top, { id: "__other__", name: "Outros", color: "#cbd1dc", value: otherValue }] : top;
  const slicesWithOffsets = slices.reduce<Array<(typeof slices)[number] & { offset: number }>>((acc, slice) => {
    const offset = acc.length === 0 ? 0 : acc[acc.length - 1].offset + (acc[acc.length - 1].value / total) * circumference;
    acc.push({ ...slice, offset });
    return acc;
  }, []);

  return (
    <div className="donut-wrap">
      <svg className="donut-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-soft)" strokeWidth={stroke} />
          {slicesWithOffsets.map((s) => {
            const frac = total > 0 ? s.value / total : 0;
            const dash = frac * circumference;
            const circle = (
              <circle
                key={s.id}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-s.offset}
                strokeLinecap="butt"
              >
                <title>{`${s.name}: ${Math.round(frac * 100)}%`}</title>
              </circle>
            );
            return circle;
          })}
        </g>
        <text x="50%" y="47%" textAnchor="middle" className="donut-center-value" fill="var(--text)">
          {rows.length}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className="donut-center-label" fill="var(--text-faint)" fontSize="10">
          atendentes
        </text>
      </svg>
      <div className="donut-legend">
        {slices.map((s) => (
          <div key={s.id} className="donut-legend-row">
            <span className="avatar" style={{ width: 18, height: 18, fontSize: 9, background: s.color, flexShrink: 0 }}>
              {s.id === "__other__" ? "" : s.id === "__none__" ? "—" : initials(s.name)}
            </span>
            <span className="name">{s.name}</span>
            <span className="pct" style={{ color: s.color === "#cbd1dc" ? "var(--text-soft)" : s.color }}>
              {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
