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
};

async function evoFetch(config: EvolutionConfig, path: string, init: RequestInit = {}) {
  const url = `${config.baseUrl.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
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

export async function createInstance(config: EvolutionConfig) {
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
  // Reemite o QR code atual (útil se o usuário precisar escanear de novo).
  return evoFetch(config, `/instance/connect/${config.instanceName}`, { method: "GET" }) as Promise<{
    base64?: string;
    code?: string;
  }>;
}

export async function getConnectionState(config: EvolutionConfig) {
  return evoFetch(config, `/instance/connectionState/${config.instanceName}`, { method: "GET" }) as Promise<{
    instance?: { state?: string };
  }>;
}

export async function setWebhook(config: EvolutionConfig, webhookUrl: string) {
  return evoFetch(config, `/webhook/set/${config.instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        url: webhookUrl,
        enabled: true,
        events: ["MESSAGES_UPSERT"],
      },
    }),
  });
}

export async function sendText(config: EvolutionConfig, number: string, text: string) {
  return evoFetch(config, `/message/sendText/${config.instanceName}`, {
    method: "POST",
    body: JSON.stringify({ number, text }),
  });
}

export async function logoutInstance(config: EvolutionConfig) {
  return evoFetch(config, `/instance/logout/${config.instanceName}`, { method: "DELETE" });
}

export async function deleteInstance(config: EvolutionConfig) {
  return evoFetch(config, `/instance/delete/${config.instanceName}`, { method: "DELETE" });
}
