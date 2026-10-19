"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { encryptJson, decryptJson } from "@/lib/crypto";
import * as evolution from "@/lib/providers/evolution";
import * as email from "@/lib/providers/email";
import * as azap from "@/lib/providers/azap";
import * as whatsappCloud from "@/lib/providers/whatsapp-cloud";
import { webhookUrl } from "@/lib/webhook-auth";
import { randomBytes } from "node:crypto";

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
  if (connection.provider === "WHATSAPP_AZAP") return { url: webhookUrl("azap", connection.id) };
  if (connection.provider === "WHATSAPP_CLOUD") {
    const base = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
    return { url: `${base}/api/webhooks/whatsapp-cloud` || "/api/webhooks/whatsapp-cloud" };
  }
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
    if (config.variant === "go") await prisma.connection.update({ where: { id: connection.id }, data: { config: encryptJson({ ...config, webhookUrl: webhookUrlFor(connection.id) }) } });
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
  const variant = formData.get("variant") === "go" ? "go" : "v2";
  const existing = formData.get("mode") === "existing";

  if (!label || !baseUrl || !apiKey || !instanceName) {
    return { error: "Preencha todos os campos." };
  }

  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return { error: "Informe uma URL HTTP/HTTPS válida, sem senha ou parâmetros." };
  } catch { return { error: "URL do servidor inválida." }; }
  if (existing && variant !== "go") return { error: "Use Evolution GO para vincular por token de instância." };
  const config: evolution.EvolutionConfig = { baseUrl, apiKey, instanceName, variant, managedInstance: !existing,
    ...(variant === "go" ? { instanceToken: existing ? apiKey : randomBytes(32).toString("hex") } : {}),
  };

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
    if (existing) {
      const result = await evolution.getConnectionState(config);
      const status = result.instance?.state === "open" ? "CONNECTED" : "DISCONNECTED";
      await prisma.connection.update({ where: { id: connection.id }, data: { status } });
      revalidatePath("/connections");
      return { connectionId: connection.id };
    }
    const created = await evolution.createInstance(config);
    if (config.variant === "go") config.instanceId = created.instanceId;
    config.webhookUrl = webhookUrlFor(connection.id);
    await prisma.connection.update({ where: { id: connection.id }, data: { config: encryptJson(config) } });
    await evolution.setWebhook(config, config.webhookUrl);

    const qrcode = created.qrcode?.base64 || (await evolution.getConnect(config)).base64;
    if (!qrcode) {
      await prisma.connection.update({
        where: { id: connection.id },
        data: { status: "CONNECTING", lastError: "Aguardando QR Code. Use Reconectar / QR Code para tentar novamente." },
      });
      revalidatePath("/connections");
      return { connectionId: connection.id, error: "Instância criada. O QR Code ainda não está pronto; use Reconectar / QR Code na conexão." };
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
  if (!connection || connection.provider !== "WHATSAPP_EVOLUTION") return { error: "Instância Evolution não encontrada." };
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
  try {
    let status: "CONNECTED" | "CONNECTING" | "DISCONNECTED" = "CONNECTED";
    if (connection.provider === "WHATSAPP_EVOLUTION") {
      const config = decryptJson<evolution.EvolutionConfig>(connection.config);
      const res = await evolution.getConnectionState(config);
      const state = res.instance?.state; // "open" | "connecting" | "close"
      status = state === "open" ? "CONNECTED" : state === "connecting" ? "CONNECTING" : "DISCONNECTED";
    } else if (connection.provider === "WHATSAPP_CLOUD") {
      await whatsappCloud.verifyConfig(decryptJson<whatsappCloud.WhatsAppCloudConfig>(connection.config));
    } else if (connection.provider === "WHATSAPP_AZAP") {
      await azap.verifyConfig(decryptJson<azap.AzapConfig>(connection.config));
    } else {
      return { status: connection.status, error: "Este canal não possui verificação manual." };
    }
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

  if (!process.env.INSTAGRAM_APP_SECRET) {
    return { error: "Configure INSTAGRAM_APP_SECRET no servidor para receber mensagens com assinatura validada." };
  }

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

export type CreateAzapState = { error?: string };
export async function createAzapConnection(_prev: CreateAzapState, formData: FormData): Promise<CreateAzapState> {
  const { organizationId } = await requireAdminUser();
  const label = String(formData.get("label") || "").trim();
  const sendUrl = String(formData.get("sendUrl") || "").trim();
  const apiKey = String(formData.get("apiKey") || "").trim();
  const instanceName = String(formData.get("instanceName") || "").trim();
  if (!label || !sendUrl || !apiKey) return { error: "Preencha nome, URL de envio e chave da API." };
  const config: azap.AzapConfig = { sendUrl, apiKey, instanceName: instanceName || undefined };
  try {
    await azap.verifyConfig(config);
    await prisma.connection.create({ data: { organizationId, provider: "WHATSAPP_AZAP", label, status: "CONNECTED", config: encryptJson(config) } });
    revalidatePath("/connections");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao validar a conexão AZAP." };
  }
}

export type CreateWhatsAppCloudState = { error?: string };
export async function createWhatsAppCloudConnection(_prev: CreateWhatsAppCloudState, formData: FormData): Promise<CreateWhatsAppCloudState> {
  const { organizationId } = await requireAdminUser();
  if (!process.env.WHATSAPP_CLOUD_APP_SECRET) {
    return { error: "Configure WHATSAPP_CLOUD_APP_SECRET no servidor para receber mensagens com assinatura validada." };
  }
  const label = String(formData.get("label") || "").trim();
  const accessToken = String(formData.get("accessToken") || "").trim();
  const phoneNumberId = String(formData.get("phoneNumberId") || "").trim();
  const apiVersion = String(formData.get("apiVersion") || "v23.0").trim();
  const verifyToken = String(formData.get("verifyToken") || "").trim();
  if (!label || !accessToken || !phoneNumberId || !verifyToken) return { error: "Preencha os campos obrigatórios, inclusive o token de verificação." };
  const config: whatsappCloud.WhatsAppCloudConfig = { accessToken, phoneNumberId, apiVersion, verifyToken };
  try {
    await whatsappCloud.verifyConfig(config);
    await prisma.connection.create({ data: { organizationId, provider: "WHATSAPP_CLOUD", label, status: "CONNECTED", config: encryptJson(config) } });
    revalidatePath("/connections");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao validar a Cloud API." };
  }
}

export async function getWebhookLogs(connectionId?: string) {
  const { organizationId } = await requireAdminUser();
  return prisma.webhookLog.findMany({ where: { organizationId, ...(connectionId ? { connectionId } : {}) }, orderBy: { createdAt: "desc" }, take: 80, select: { id: true, source: true, event: true, statusCode: true, detail: true, createdAt: true, connectionId: true } });
}

export async function deleteConnection(connectionId: string) {
  const { organizationId } = await requireAdminUser();
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, organizationId } });
  if (!connection) return;
  if (connection.provider === "WHATSAPP_EVOLUTION") {
    try {
      const config = decryptJson<evolution.EvolutionConfig>(connection.config);
      // Instâncias vinculadas podem atender outras ferramentas. Remover do CRM
      // não deve derrubar a sessão ou apagar a instância externa.
      if (config.managedInstance) {
        await evolution.logoutInstance(config);
        await evolution.deleteInstance(config);
      }
    } catch {
      // melhor esforço — a instância pode já estar fora do ar
    }
  }
  await prisma.connection.delete({ where: { id: connectionId } });
  revalidatePath("/connections");
}
