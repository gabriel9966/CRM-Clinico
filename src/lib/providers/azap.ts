import "server-only";

// AZAP pode ser hospedado em domínios diferentes. O administrador informa a
// URL completa do endpoint de envio conforme a documentação da sua conta.
export type AzapConfig = { sendUrl: string; apiKey: string; instanceName?: string; webhookSecret?: string };

export async function sendText(config: AzapConfig, destination: string, text: string) {
  const response = await fetch(config.sendUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "X-API-Key": config.apiKey },
    body: JSON.stringify({ phone: destination.replace(/\D/g, ""), number: destination.replace(/\D/g, ""), text, message: text, instance: config.instanceName }),
  });
  if (!response.ok) throw new Error(`AZAP: ${(await response.text()).slice(0, 500)}`);
  return response.json().catch(() => ({}));
}

export async function verifyConfig(config: AzapConfig) {
  if (!/^https:\/\//i.test(config.sendUrl)) throw new Error("Informe uma URL HTTPS de envio da AZAP.");
}
