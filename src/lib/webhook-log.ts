import "server-only";
import { prisma } from "./prisma";

const safePayload = (payload: unknown) => {
  try { return JSON.stringify(payload).slice(0, 4000); } catch { return "[payload não serializável]"; }
};

export async function logWebhook(input: { organizationId: string; connectionId?: string | null; source: string; event?: string | null; statusCode: number; detail?: string | null; payload?: unknown }) {
  try {
    await prisma.webhookLog.create({ data: { organizationId: input.organizationId, connectionId: input.connectionId ?? null, source: input.source, event: input.event ?? null, statusCode: input.statusCode, detail: input.detail ?? null, payload: input.payload === undefined ? null : safePayload(input.payload) } });
  } catch (error) {
    console.error("[webhook-log] falha ao gravar:", error);
  }
}
