import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {}, prismaRaw: {} }));

import { phoneVariants } from "../inbound";
import { parseEvolutionEvent } from "../providers/evolution-events";

describe("phoneVariants", () => {
  it("casa o telefone digitado com o número que o WhatsApp entrega", () => {
    const fromChannel = phoneVariants("+5515991652134");
    for (const typed of ["(15) 99165-2134", "15991652134", "+55 15 99165-2134"]) {
      expect(phoneVariants(typed).some((form) => fromChannel.includes(form))).toBe(true);
    }
  });

  it("considera o celular com e sem o nono dígito", () => {
    expect(phoneVariants("5511988881234")).toEqual(expect.arrayContaining(["11988881234", "1188881234", "551188881234"]));
    expect(phoneVariants("551188881234")).toEqual(expect.arrayContaining(["11988881234", "5511988881234"]));
  });

  it("não inventa nono dígito em telefone fixo nem aceita número curto", () => {
    expect(phoneVariants("(11) 3333-4444")).not.toContain("11933334444");
    expect(phoneVariants("1234")).toEqual([]);
  });
});

describe("parseEvolutionEvent com endereçamento LID", () => {
  const goMessage = (info: Record<string, unknown>) => ({
    event: "Message",
    data: { Info: { ID: "M1", PushName: "Cliente", Timestamp: "2026-10-19T00:30:49-03:00", ...info }, Message: { conversation: "Olá" } },
  });

  it("usa SenderAlt quando o chat chega como @lid (Evolution GO)", () => {
    const parsed = parseEvolutionEvent(goMessage({ Chat: "123456789@lid", Sender: "123456789@lid", SenderAlt: "5515991652134@s.whatsapp.net", IsFromMe: false }));
    expect(parsed).toMatchObject({ kind: "message", jid: "5515991652134@s.whatsapp.net", text: "Olá", fromMe: false });
  });

  it("usa RecipientAlt na mensagem enviada pelo próprio aparelho", () => {
    const parsed = parseEvolutionEvent({ ...goMessage({ Chat: "123456789@lid", IsFromMe: true, RecipientAlt: "5515991652134@s.whatsapp.net" }), event: "SendMessage" });
    expect(parsed).toMatchObject({ kind: "message", jid: "5515991652134@s.whatsapp.net", fromMe: true });
  });

  it("usa remoteJidAlt da Evolution v2", () => {
    const parsed = parseEvolutionEvent({ event: "messages.upsert", data: { key: { remoteJid: "999@lid", remoteJidAlt: "5511988881234@s.whatsapp.net", fromMe: false, id: "X" }, message: { conversation: "Oi" } } });
    expect(parsed).toMatchObject({ kind: "message", jid: "5511988881234@s.whatsapp.net" });
  });

  it("explica por que descartou: LID sem telefone, grupo e mídia", () => {
    expect(parseEvolutionEvent(goMessage({ Chat: "123@lid", SenderAlt: "" }))).toMatchObject({ kind: "ignored", reason: expect.stringContaining("LID") });
    expect(parseEvolutionEvent(goMessage({ Chat: "1203630@g.us", IsGroup: true }))).toMatchObject({ kind: "ignored", reason: "grupo" });
    expect(parseEvolutionEvent({ event: "Message", data: { Info: { Chat: "5511988881234@s.whatsapp.net" }, Message: { imageMessage: {} } } })).toMatchObject({ kind: "ignored", reason: expect.stringContaining("sem texto") });
  });

  it("lê o horário ISO do Evolution GO", () => {
    const parsed = parseEvolutionEvent(goMessage({ Chat: "5515991652134@s.whatsapp.net" }));
    expect(parsed.kind === "message" && parsed.time.toISOString()).toBe("2026-10-19T03:30:49.000Z");
  });
});
