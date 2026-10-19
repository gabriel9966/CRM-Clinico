import "server-only";

// Cliente para a Evolution API (https://doc.evolution-api.com/), usada para
// conectar a própria instância de WhatsApp do usuário (não é uma conta fixa
// da plataforma — cada conexão aponta para o servidor Evolution que a pessoa
// mesma hospeda ou contrata, com a própria API key).
//
// Baseado nos endpoints da v2 da Evolution API. Se a instância do usuário for
// uma versão mais antiga, os caminhos podem variar — ajuste aqui conforme
// necessário.

export type EvolutionConfig = {
  baseUrl: string; // ex: https://evolution.seudominio.com
  apiKey: string; // API key global/admin da instância Evolution
  instanceName: string;
  variant?: "v2" | "go";
  instanceToken?: string;
  instanceId?: string;
  webhookUrl?: string;
  managedInstance?: boolean;
};

async function evoFetch(config: EvolutionConfig, path: string, init: RequestInit = {}) {
  const url = `${config.baseUrl.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/json",
      apikey: config.variant === "go" ? config.instanceToken || config.apiKey : config.apiKey,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    let message = `Evolution API respondeu ${res.status}`;
    if (json && typeof json === "object" && "message" in json) {
      message = String((json as { message: unknown }).message);
    }
    throw new Error(message);
  }
  return json;
}

export async function createInstance(config: EvolutionConfig): Promise<{ instance?: { instanceName?: string }; instanceId?: string; hash?: string | { apikey?: string }; qrcode?: { base64?: string; code?: string } }> {
  if (config.variant === "go") {
    const result = await evoFetch({ ...config, instanceToken: undefined }, "/instance/create", {
      method: "POST", body: JSON.stringify({ name: config.instanceName, token: config.instanceToken }),
    }) as { data?: { id?: string } };
    return { instance: { instanceName: config.instanceName }, instanceId: result.data?.id };
  }
  return evoFetch(config, "/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName: config.instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    }),
  }) as Promise<{
    instance?: { instanceName?: string };
    hash?: string | { apikey?: string };
    qrcode?: { base64?: string; code?: string };
  }>;
}

export async function getConnect(config: EvolutionConfig) {
  if (config.variant === "go") {
    await evoFetch(config, "/instance/connect", { method: "POST", body: JSON.stringify({
      ...(config.webhookUrl ? { webhookUrl: config.webhookUrl, subscribe: ["MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION"] } : {}),
    }) });
    const result = await evoFetch(config, "/instance/qr") as { data?: { code?: string; qrcode?: string; base64?: string } };
    const candidate = [result.data?.code, result.data?.base64, result.data?.qrcode].find((value) => value?.startsWith("data:image/"));
    return { base64: candidate };
  }
  // Reemite o QR code atual (útil se o usuário precisar escanear de novo).
  return evoFetch(config, `/instance/connect/${config.instanceName}`, { method: "GET" }) as Promise<{
    base64?: string;
    code?: string;
  }>;
}

export async function getConnectionState(config: EvolutionConfig) {
  if (config.variant === "go") {
    const result = await evoFetch(config, "/instance/status") as { data?: { connected?: boolean; loggedIn?: boolean; Connected?: boolean; LoggedIn?: boolean } };
    const connected = result.data?.connected ?? result.data?.Connected;
    const loggedIn = result.data?.loggedIn ?? result.data?.LoggedIn;
    return { instance: { state: connected && loggedIn ? "open" : connected ? "connecting" : "close" } };
  }
  return evoFetch(config, `/instance/connectionState/${config.instanceName}`, { method: "GET" }) as Promise<{
    instance?: { state?: string };
  }>;
}

export async function setWebhook(config: EvolutionConfig, webhookUrl: string) {
  if (config.variant === "go") {
    return evoFetch(config, "/instance/connect", { method: "POST", body: JSON.stringify({ webhookUrl, subscribe: ["MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION"] }) });
  }
  return evoFetch(config, `/webhook/set/${config.instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        url: webhookUrl,
        enabled: true,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      },
    }),
  });
}

export async function sendText(config: EvolutionConfig, number: string, text: string) {
  if (config.variant === "go") {
    const response = await evoFetch(config, "/send/text", { method: "POST", body: JSON.stringify({ number, text, formatJid: true }) }) as { data?: { Info?: { ID?: string }; id?: string } };
    return { key: { id: response.data?.Info?.ID || response.data?.id } };
  }
  return evoFetch(config, `/message/sendText/${config.instanceName}`, {
    method: "POST",
    body: JSON.stringify({ number, text }),
  });
}

export async function logoutInstance(config: EvolutionConfig) {
  if (config.variant === "go") return evoFetch(config, "/instance/logout", { method: "DELETE" });
  return evoFetch(config, `/instance/logout/${config.instanceName}`, { method: "DELETE" });
}

export async function deleteInstance(config: EvolutionConfig) {
  if (config.variant === "go") {
    if (!config.managedInstance || !config.instanceId) return;
    return evoFetch({ ...config, instanceToken: undefined }, `/instance/delete/${encodeURIComponent(config.instanceId)}`, { method: "DELETE" });
  }
  return evoFetch(config, `/instance/delete/${config.instanceName}`, { method: "DELETE" });
}
