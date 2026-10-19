import { afterEach, describe, expect, it, vi } from "vitest";
import { getConnectionState, getConnect, sendText, createInstance, deleteInstance } from "../providers/evolution";
import { parseEvolutionEvent } from "../providers/evolution-events";
const config = { baseUrl: "https://evo.example", apiKey: "admin", instanceName: "crm", instanceToken: "instance-secret", variant: "go" as const };
afterEach(() => vi.unstubAllGlobals());
function response(data: unknown) { return new Response(JSON.stringify(data), { status: 200 }); }
describe("Evolution GO", () => {
  it("usa token da instância para status e exige login concluído", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ data: { connected: true, loggedIn: false } })).mockResolvedValueOnce(response({ data: { Connected: true, LoggedIn: true } })); vi.stubGlobal("fetch", fetch);
    expect((await getConnectionState(config)).instance?.state).toBe("connecting");
    expect(fetch.mock.calls[0][1].headers.apikey).toBe("instance-secret");
    expect((await getConnectionState(config)).instance?.state).toBe("open");
  });
  it("cria com chave global e preserva ID para gerenciar apenas instâncias próprias", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { id: "uuid" } })); vi.stubGlobal("fetch", fetch);
    expect((await createInstance(config)).instanceId).toBe("uuid");
    expect(fetch.mock.calls[0][1].headers.apikey).toBe("admin");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ name: "crm", token: "instance-secret" });
    await deleteInstance(config); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("obtém QR sem substituir webhook de instância vinculada", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ message: "success" })).mockResolvedValueOnce(response({ data: { code: "2@raw-pairing-code", qrcode: "data:image/png;base64,abc" } })); vi.stubGlobal("fetch", fetch);
    expect((await getConnect(config)).base64).toBe("data:image/png;base64,abc");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({});
  });
  it("normaliza ID da mensagem enviada", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { Info: { ID: "message-1" } } })); vi.stubGlobal("fetch", fetch);
    expect((await sendText(config, "5511999999999", "Oi")) as unknown).toEqual({ key: { id: "message-1" } });
    expect(fetch.mock.calls[0][0]).toBe("https://evo.example/send/text");
  });
});
describe("eventos Evolution", () => {
  it("normaliza Baileys e GO sem confundir confirmação com entrada", () => {
    expect(parseEvolutionEvent({ event: "messages.upsert", data: { key: { id: "1", remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: "Oi" }, messageTimestamp: "1700000000" } })).toMatchObject({ kind: "message", id: "1", text: "Oi", fromMe: false });
    expect(parseEvolutionEvent({ event: "Message", data: { Info: { ID: "2", Chat: "5511999999999@s.whatsapp.net", PushName: "Maria", Timestamp: "2026-10-19T00:00:00Z" }, Message: { extendedTextMessage: { text: "Olá" } } } })).toMatchObject({ kind: "message", id: "2", text: "Olá", name: "Maria" });
    expect(parseEvolutionEvent({ event: "Receipt", data: { MessageIDs: ["2"], Type: "read" } })).toEqual({ kind: "receipt", ids: ["2"], status: "read" });
    expect(parseEvolutionEvent({ event: "messages.update", data: { key: { id: "2" }, update: { status: 3 } } })).toEqual({ kind: "receipt", ids: ["2"], status: "delivered" });
  });
  it("ignora grupos e eventos desconhecidos", () => {
    expect(parseEvolutionEvent({ event: "message", data: { key: { remoteJid: "123@g.us" }, message: { conversation: "grupo" } } }).kind).toBe("ignored");
    expect(parseEvolutionEvent({ event: "Connected" })).toEqual({ kind: "connection", status: "CONNECTED" });
  });
});
