// Run deliberately after deployment; never runs as part of app startup.
// Credentials come from a root-only env file, never command-line arguments.
import { prisma } from "../src/lib/prisma";
import { decryptJson, encryptJson } from "../src/lib/crypto";
import { webhookUrl } from "../src/lib/webhook-auth";
import { getConnectionState, setWebhook, type EvolutionConfig } from "../src/lib/providers/evolution";

async function main() {
  const organizationId = process.env.EVOLUTION_LINK_ORGANIZATION_ID;
  const baseUrl = process.env.EVOLUTION_GO_BASE_URL;
  const globalKey = process.env.EVOLUTION_GO_GLOBAL_KEY;
  const name = process.env.EVOLUTION_LINK_INSTANCE_NAME;
  if (!organizationId || !baseUrl || !globalKey || !name) throw new Error("Configure organization, base URL, global key and exact instance name.");
  await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true } });
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/instance/all`, { headers: { apikey: globalKey }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Evolution GO HTTP ${response.status}`);
  const body = await response.json() as { data?: { name: string; id: string; token: string; webhook?: string }[] };
  const matching = body.data?.filter((item) => item.name === name) || [];
  if (matching.length !== 1 || !matching[0].token) throw new Error("Expected exactly one existing instance with a token.");
  const instance = matching[0];
  const connections = await prisma.connection.findMany({ where: { organizationId, provider: "WHATSAPP_EVOLUTION" } });
  const existing = connections.find((item) => {
    const config = decryptJson<EvolutionConfig>(item.config);
    return config.variant === "go" && config.baseUrl === baseUrl && config.instanceName === name;
  });
  const config: EvolutionConfig = { variant: "go", baseUrl, instanceName: name, instanceId: instance.id, apiKey: instance.token, instanceToken: instance.token, managedInstance: false };
  // Refuse to steal an instance from an existing integration.
  if (instance.webhook && (!existing || instance.webhook !== webhookUrl("evolution", existing.id))) throw new Error("Instance already has another webhook. No changes made.");
  const connection = existing || await prisma.connection.create({ data: { organizationId, label: `WhatsApp · ${name}`, provider: "WHATSAPP_EVOLUTION", status: "DISCONNECTED", config: encryptJson(config) } });
  config.webhookUrl = webhookUrl("evolution", connection.id);
  await prisma.connection.update({ where: { id: connection.id }, data: { config: encryptJson(config) } });
  await setWebhook(config, config.webhookUrl);
  const state = await getConnectionState(config);
  const status = state.instance?.state === "open" ? "CONNECTED" : state.instance?.state === "connecting" ? "CONNECTING" : "DISCONNECTED";
  await prisma.connection.update({ where: { id: connection.id }, data: { status, lastError: null } });
  console.log(JSON.stringify({ connectionId: connection.id, instance: name, status, webhookConfigured: true }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Unable to link instance"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
