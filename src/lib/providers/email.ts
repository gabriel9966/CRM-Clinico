import "server-only";

export type EmailConfig = {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
};

// Verifica a API key chamando um endpoint de leitura da Resend — não envia
// nada, só confirma que a key é válida antes de salvar a conexão.
export async function verifyConfig(config: EmailConfig) {
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.message || `Resend respondeu ${res.status}`);
  }
}

export async function sendText(config: EmailConfig, to: string, text: string, subject?: string) {
  const from = config.fromName ? `${config.fromName} <${config.fromAddress}>` : config.fromAddress;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: subject || "Mensagem",
      text,
    }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.message || `Resend respondeu ${res.status}`);
  }
  return json;
}
