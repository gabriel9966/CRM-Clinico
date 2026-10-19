// Normaliza Evolution API v2 (Baileys) e Evolution GO (Whatsmeow).
// Não confunde confirmação/alteração de mensagem com uma mensagem recebida.
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
export function parseEvolutionEvent(input: unknown) {
  const body = obj(input);
  const event = str(body.event || body.Event).toLowerCase().replace(/_/g, ".");
  const data = obj(body.data || body.Data);
  if (["connected", "disconnected", "loggedout", "connection.update"].includes(event)) {
    const state = str(data.state || obj(data.instance).state);
    return { kind: "connection" as const, status: event === "connected" || state === "open" ? "CONNECTED" as const : state === "connecting" ? "CONNECTING" as const : "DISCONNECTED" as const };
  }
  if (["receipt", "read.receipt", "messages.update"].includes(event)) {
    const update = obj(data.update);
    const raw = data.Type || data.type || update.status || data.status;
    const status = raw === "read" || raw === "played" || raw === "READ" || raw === 4 || raw === 5 ? "read" : raw === "delivered" || raw === "delivery" || raw === "DELIVERY_ACK" || raw === 3 ? "delivered" : raw === "failed" || raw === 0 ? "failed" : null;
    const ids = Array.isArray(data.MessageIDs) ? data.MessageIDs.filter((x): x is string => typeof x === "string") : [str(obj(data.key).id || data.id)].filter(Boolean);
    return { kind: "receipt" as const, ids, status };
  }
  if (!["messages.upsert", "message", "sendmessage"].includes(event)) return { kind: "ignored" as const };
  const info = obj(data.Info);
  const key = obj(data.key);
  const jid = str(key.remoteJid || info.Chat);
  if (!/^\d+(?::\d+)?@(s\.whatsapp\.net|c\.us)$/.test(jid)) return { kind: "ignored" as const };
  let message = obj(data.message || data.Message);
  const wrapped = obj(obj(message.ephemeralMessage).message || obj(message.viewOnceMessage).message);
  if (Object.keys(wrapped).length) message = wrapped;
  const text = str(message.conversation || obj(message.extendedTextMessage).text);
  if (!text) return { kind: "ignored" as const };
  const timestamp = data.messageTimestamp || info.Timestamp;
  const time = typeof timestamp === "number" || typeof timestamp === "string" && /^\d+$/.test(timestamp) ? new Date(Number(timestamp) * 1000) : new Date(str(timestamp));
  return { kind: "message" as const, jid: jid.replace(/:\d+@/, "@"), text,
    fromMe: key.fromMe === true || info.IsFromMe === true || event === "sendmessage",
    id: str(key.id || info.ID) || undefined, name: str(data.pushName || info.PushName),
    time: Number.isFinite(time.getTime()) ? time : new Date(),
  };
}
