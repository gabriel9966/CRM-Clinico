import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "./prisma";
import { encryptJson, decryptJson } from "./crypto";

function generateKey() {
  return `mcp_${randomBytes(24).toString("hex")}`;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function getOrCreateMcpApiKey(organizationId: string): Promise<string> {
  const existing = await prisma.mcpConfig.findUnique({ where: { organizationId } });
  if (existing) return decryptJson<string>(existing.apiKey);

  const key = generateKey();
  await prisma.mcpConfig.create({ data: { organizationId, apiKey: encryptJson(key), apiKeyHash: hashApiKey(key) } });
  return key;
}

export async function regenerateMcpApiKey(organizationId: string): Promise<string> {
  const key = generateKey();
  const apiKeyHash = hashApiKey(key);
  await prisma.mcpConfig.upsert({
    where: { organizationId },
    create: { organizationId, apiKey: encryptJson(key), apiKeyHash },
    update: { apiKey: encryptJson(key), apiKeyHash },
  });
  return key;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Usado pelo endpoint /api/mcp e pela API /api/v1: valida a chave e devolve A
// ORGANIZAÇÃO DONA dela, pra que toda ferramenta chamada em seguida fique
// isolada a essa empresa. Retorna null se a chave não bate com nenhuma.
//
// A busca é por hash indexado (uma consulta), não decifrando a chave de todas
// as empresas. Chaves criadas antes do hash existir (apiKeyHash nulo) são
// conferidas no caminho antigo UMA vez e ganham o hash — depois disso entram no
// caminho rápido.
export async function resolveOrgByMcpApiKey(token: string): Promise<string | null> {
  if (!token) return null;

  const byHash = await prisma.mcpConfig.findUnique({ where: { apiKeyHash: hashApiKey(token) } });
  if (byHash) return byHash.organizationId;

  const legacy = await prisma.mcpConfig.findMany({ where: { apiKeyHash: null } });
  for (const config of legacy) {
    let stored: string;
    try {
      stored = decryptJson<string>(config.apiKey);
    } catch {
      continue; // chave ilegível (segredo de criptografia trocado): ignora esta
    }
    if (safeEqual(stored, token)) {
      await prisma.mcpConfig.update({ where: { id: config.id }, data: { apiKeyHash: hashApiKey(stored) } });
      return config.organizationId;
    }
  }
  return null;
}
