"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { encryptJson, decryptJson } from "@/lib/crypto";
import * as evolution from "@/lib/providers/evolution";
import * as email from "@/lib/providers/email";
import { webhookUrl } from "@/lib/webhook-auth";

function webhookUrlFor(connectionId: string) {
  return webhookUrl("evolution", connectionId);
}

// URL de webhook (com token) para o usuário copiar — usada pelas conexões de
// e-mail, onde a URL é colada no provedor de inbound.
export async function getConnectionWebhookUrl(connectionId: string): Promise<{ url?: string; error?: string }> {
  const { organizationId } = await requireAdminUser();
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, organizationId } });
  if (!connection) return { error: "Conexão não encontrada." };
  if (connection.provider === "WHATSAPP_EVOLUTION") return { url: webhookUrl("evolution", connection.id) };
  if (connection.provider === "EMAIL") return { url: webhookUrl("email", connection.id) };
  return { error: "Este canal usa um webhook único configurado no painel da Meta." };
}

// Reaplica o webhook na instância da Evolution com a URL que contém o token.
// Necessário para conexões criadas antes da proteção por token.
export async function refreshWhatsAppWebhook(connectionId: string): Promise<{ ok: boolean; error?: string }> {
  const { organizationId } = await requireAdminUser();
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, organizationId } });
  if (!connection || connection.provider !== "WHATSAPP_EVOLUTION") return { ok: false, error: "Conexão não encontrada." };
  try {
    const config = decryptJson<evolution.EvolutionConfig>(connection.config);
    await evolution.setWebhook(config, webhookUrlFor(connection.id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao atualizar o webhook." };
  }
}

export type CreateWhatsAppState = { error?: string; connectionId?: string; qrcode?: string };

export async function createWhatsAppConnection(
  _prev: CreateWhatsAppState,
  formData: FormData
): Promise<CreateWhatsAppState> {
  const { organizationId } = await requireAdminUser();
  const label = String(formData.get("label") || "").trim();
  const baseUrl = String(formData.get("baseUrl") || "").trim();
  const apiKey = String(formData.get("apiKey") || "").trim();
  const instanceName = String(formData.get("instanceName") || "").trim();

  if (!label || !baseUrl || !apiKey || !instanceName) {
    return { error: "Preencha todos os campos." };
  }

  const config = { baseUrl, apiKey, instanceName };

  const connection = await prisma.connection.create({
    data: {
      organizationId,
      provider: "WHATSAPP_EVOLUTION",
      label,
      status: "CONNECTING",
      config: encryptJson(config),
    },
  });

  try {
    const created = await evolution.createInstance(config);
    try {
      await evolution.setWebhook(config, webhookUrlFor(connection.id));
    } catch {
      // Webhook pode falhar se a instância ainda não terminou de subir;
      // o usuário consegue reconfigurar manualmente no painel da Evolution se preciso.
    }

    const qrcode = created.qrcode?.base64;
    if (!qrcode) {
      await prisma.connection.update({
        where: { id: connection.id },
        data: { status: "ERROR", lastError: "A Evolution API não retornou um QR code. Verifique a URL e a API key." },
      });
      revalidatePath("/connections");
      return { error: "Instância criada, mas não veio QR code. Confira os dados e tente novamente." };
    }

    revalidatePath("/connections");
    return { connectionId: connection.id, qrcode };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao criar a instância na Evolution API.";
    await prisma.connection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastError: message },
    });
    revalidatePath("/connections");
    return { error: message };
  }
}

export async function refreshWhatsAppQr(connectionId: string): Promise<{ qrcode?: string; error?: string }> {
  const { organizationId } = await requireAdminUser();
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, organizationId } });
  if (!connection) return { error: "Conexão não encontrada." };
  const config = decryptJson<evolution.EvolutionConfig>(connection.config);
  try {
    const res = await evolution.getConnect(config);
    if (!res.base64) return { error: "Não foi possível obter um novo QR code." };
    return { qrcode: res.base64 };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao buscar QR code." };
  }
}

export async function checkWhatsAppStatus(connectionId: string): Promise<{ status: string; error?: string }> {
  const { organizationId } = await requireAdminUser();
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, organizationId } });
  if (!connection) return { status: "DISCONNECTED", error: "Conexão não encontrada." };
  const config = decryptJson<evolution.EvolutionConfig>(connection.config);
  try {
    const res = await evolution.getConnectionState(config);
    const state = res.instance?.state; // "open" | "connecting" | "close"
    const status = state === "open" ? "CONNECTED" : state === "connecting" ? "CONNECTING" : "DISCONNECTED";
    await prisma.connection.update({ where: { id: connectionId }, data: { status, lastError: null } });
    revalidatePath("/connections");
    return { status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao checar status.";
    await prisma.connection.update({ where: { id: connectionId }, data: { status: "ERROR", lastError: message } });
    revalidatePath("/connections");
    return { status: "ERROR", error: message };
  }
}

export type CreateInstagramState = { error?: string };

export async function createInstagramConnection(
  _prev: CreateInstagramState,
  formData: FormData
): Promise<CreateInstagramState> {
  const { organizationId } = await requireAdminUser();
  const label = String(formData.get("label") || "").trim();
  const accessToken = String(formData.get("accessToken") || "").trim();
  const igUserId = String(formData.get("igUserId") || "").trim();

  if (!label || !accessToken || !igUserId) {
    return { error: "Preencha todos os campos." };
  }

  const config = { accessToken, igUserId };
  let status: "CONNECTED" | "ERROR" = "CONNECTED";
  let lastError: string | null = null;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" }
    );
    const json = await res.json();
    if (!res.ok) {
      status = "ERROR";
      lastError = json?.error?.message || "Token ou ID da conta inválidos.";
    }
  } catch (err) {
    status = "ERROR";
    lastError = err instanceof Error ? err.message : "Falha ao validar com a Meta.";
  }

  await prisma.connection.create({
    data: {
      organizationId,
      provider: "INSTAGRAM",
      label,
      status,
      lastError,
      config: encryptJson(config),
    },
  });

  revalidatePath("/connections");
  if (status === "ERROR") return { error: lastError ?? undefined };
  return {};
}

export type CreateEmailState = { error?: string };

export async function createEmailConnection(
  _prev: CreateEmailState,
  formData: FormData
): Promise<CreateEmailState> {
  const { organizationId } = await requireAdminUser();
  const label = String(formData.get("label") || "").trim();
  const apiKey = String(formData.get("apiKey") || "").trim();
  const fromAddress = String(formData.get("fromAddress") || "").trim();
  const fromName = String(formData.get("fromName") || "").trim();

  if (!label || !apiKey || !fromAddress) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const config: email.EmailConfig = { apiKey, fromAddress, fromName: fromName || undefined };
  let status: "CONNECTED" | "ERROR" = "CONNECTED";
  let lastError: string | null = null;

  try {
    await email.verifyConfig(config);
  } catch (err) {
    status = "ERROR";
    lastError = err instanceof Error ? err.message : "Falha ao validar a API key.";
  }

  await prisma.connection.create({
    data: {
      organizationId,
      provider: "EMAIL",
      label,
      status,
      lastError,
      config: encryptJson(config),
    },
  });

  revalidatePath("/connections");
  if (status === "ERROR") return { error: lastError ?? undefined };
  return {};
}

export async function deleteConnection(connectionId: string) {
  const { organizationId } = await requireAdminUser();
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, organizationId } });
  if (!connection) return;
  if (connection.provider === "WHATSAPP_EVOLUTION") {
    try {
      const config = decryptJson<evolution.EvolutionConfig>(connection.config);
      await evolution.logoutInstance(config);
      await evolution.deleteInstance(config);
    } catch {
      // melhor esforço — a instância pode já estar fora do ar
    }
  }
  await prisma.connection.delete({ where: { id: connectionId } });
  revalidatePath("/connections");
}
