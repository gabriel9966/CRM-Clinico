import "server-only";

export type WhatsAppCloudConfig = { accessToken: string; phoneNumberId: string; apiVersion?: string; verifyToken?: string };

export async function sendText(config: WhatsAppCloudConfig, destination: string, text: string) {
  const to = destination.replace(/\D/g, "");
  const version = config.apiVersion || "v23.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } }),
  });
  if (!response.ok) throw new Error(`WhatsApp Cloud API: ${(await response.text()).slice(0, 500)}`);
  return response.json() as Promise<{ messages?: Array<{ id?: string }> }>;
}

/** Envio fora da janela de atendimento pela mensagem modelo previamente aprovada na Meta. */
export async function sendTemplate(config: WhatsAppCloudConfig, destination: string, name: string, language = "pt_BR", bodyParameters: string[] = []) {
  const to = destination.replace(/\D/g, "");
  const version = config.apiVersion || "v23.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: language }, ...(bodyParameters.length ? { components: [{ type: "body", parameters: bodyParameters.map((text) => ({ type: "text", text })) }] } : {}) } }),
  });
  if (!response.ok) throw new Error(`WhatsApp Cloud API: ${(await response.text()).slice(0, 500)}`);
  return response.json() as Promise<{ messages?: Array<{ id?: string }> }>;
}

export async function verifyConfig(config: WhatsAppCloudConfig) {
  const version = config.apiVersion || "v23.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${config.phoneNumberId}`, { headers: { Authorization: `Bearer ${config.accessToken}` } });
  if (!response.ok) throw new Error(`Não foi possível validar a Cloud API: ${(await response.text()).slice(0, 500)}`);
}
