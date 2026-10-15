import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

try {
  process.loadEnvFile(".env");
} catch {
  // already loaded or absent
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Senhas aleatórias a cada seed (ou fixas via SEED_PASSWORD, só para dev/CI).
// Nunca deixe senha de demonstração no código: o seed roda em produção no
// primeiro boot do container.
const randomPassword = () => process.env.SEED_PASSWORD || randomBytes(9).toString("base64url");
const adminPassword = randomPassword();
const demoPassword = randomPassword();

const DEFAULT_STAGES = [
  { label: "Novo Lead", color: "#64748b" },
  { label: "Contato Feito", color: "#2563eb" },
  { label: "Proposta Enviada", color: "#7c3aed" },
  { label: "Negociação", color: "#ea580c" },
  { label: "Ganho", color: "#16a34a" },
  { label: "Perdido", color: "#dc2626" },
];

async function main() {
  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log("Banco já populado, pulando seed.");
    return;
  }

  const org = await prisma.organization.create({
    data: { name: "NovaCRM Demo", slug: "novacrm-demo" },
  });

  // Super-admin da plataforma: gerencia todas as empresas pelo painel /admin,
  // e também pertence a esta organização pra poder usar o CRM normalmente
  // (ex: pra administrar os próprios leads/vendas da NovaCRM).
  await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Admin da Plataforma",
      email: "admin@novacrm.com",
      passwordHash: await bcrypt.hash(adminPassword, 10),
      color: "#111827",
      role: "ADMIN",
      isSuperAdmin: true,
    },
  });

  const [ana, carlos, paula] = await Promise.all([
    prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ana Martins",
        email: "ana@novacrm.com",
        passwordHash: await bcrypt.hash(demoPassword, 10),
        color: "#4f46e5",
        role: "ADMIN",
      },
    }),
    prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Carlos Vieira",
        email: "carlos@novacrm.com",
        passwordHash: await bcrypt.hash(demoPassword, 10),
        color: "#0891b2",
      },
    }),
    prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Paula Quirino",
        email: "paula@novacrm.com",
        passwordHash: await bcrypt.hash(demoPassword, 10),
        color: "#db2777",
      },
    }),
  ]);

  const pipeline = await prisma.pipeline.create({
    data: {
      organizationId: org.id,
      name: "Vendas",
      stages: { create: DEFAULT_STAGES.map((s, i) => ({ ...s, order: i })) },
    },
    include: { stages: true },
  });
  const stage = (label: string) => pipeline.stages.find((s) => s.label === label)!.id;

  const now = Date.now();
  const day = 86400000;

  const contactsData = [
    { name: "Marina Souza", company: "Olivia Studio", email: "marina@oliviastudio.com", phone: "(11) 98888-1234", tags: ["VIP", "E-commerce"], notes: "Conheceu pelo Instagram. Interessada em plano anual.", ownerId: ana.id },
    { name: "Rafael Lima", company: "Construtora Pinheiro", email: "rafael.lima@pinheiro.com.br", phone: "(21) 97777-5566", tags: ["B2B"], notes: "Pediu orçamento para 3 unidades.", ownerId: carlos.id },
    { name: "Juliana Alves", company: "Studio JA Design", email: "ju@studioja.com", phone: "(31) 96666-9988", tags: ["Indicação"], notes: "", ownerId: ana.id },
    { name: "Pedro Mendes", company: "TechNorte", email: "pedro@technorte.io", phone: "(47) 95555-4321", tags: ["Frio"], notes: "Baixou o material rico, nunca respondeu e-mail.", ownerId: paula.id },
    { name: "Camila Rocha", company: "Doce Ponto Confeitaria", email: "camila@doceponto.com", phone: "(85) 94444-7890", tags: ["E-commerce", "Recorrente"], notes: "Já é cliente de outro produto nosso.", ownerId: carlos.id },
    { name: "Bruno Castro", company: "Castro Advocacia", email: "bruno@castroadv.com", phone: "(51) 93333-2211", tags: [], notes: "", ownerId: paula.id },
  ];

  const contacts = [];
  for (const c of contactsData) {
    contacts.push(
      await prisma.contact.create({
        data: { ...c, organizationId: org.id, tags: JSON.stringify(c.tags) },
      })
    );
  }
  const [marina, rafael, juliana, pedro, camila, bruno] = contacts;

  await prisma.opportunity.createMany({
    data: [
      { organizationId: org.id, title: "Plano Anual Pro", contactId: marina.id, pipelineId: pipeline.id, stageId: stage("Negociação"), ownerId: ana.id, value: 14400, expectedClose: new Date(now + 7 * day) },
      { organizationId: org.id, title: "Licenças corporativas (3 unid.)", contactId: rafael.id, pipelineId: pipeline.id, stageId: stage("Proposta Enviada"), ownerId: carlos.id, value: 32000, expectedClose: new Date(now + 14 * day) },
      { organizationId: org.id, title: "Setup + onboarding", contactId: juliana.id, pipelineId: pipeline.id, stageId: stage("Contato Feito"), ownerId: ana.id, value: 5200, expectedClose: new Date(now + 10 * day) },
      { organizationId: org.id, title: "Plano Starter", contactId: pedro.id, pipelineId: pipeline.id, stageId: stage("Novo Lead"), ownerId: paula.id, value: 1800, expectedClose: new Date(now + 20 * day) },
      { organizationId: org.id, title: "Upgrade para plano Scale", contactId: camila.id, pipelineId: pipeline.id, stageId: stage("Ganho"), ownerId: carlos.id, value: 9600, expectedClose: new Date(now - 1 * day) },
      { organizationId: org.id, title: "Consultoria pontual", contactId: bruno.id, pipelineId: pipeline.id, stageId: stage("Novo Lead"), ownerId: paula.id, value: 3200, expectedClose: new Date(now + 25 * day) },
      { organizationId: org.id, title: "Plano Pro mensal", contactId: juliana.id, pipelineId: pipeline.id, stageId: stage("Perdido"), ownerId: ana.id, value: 1200, expectedClose: new Date(now - 5 * day) },
    ],
  });

  await prisma.message.createMany({
    data: [
      { organizationId: org.id, contactId: marina.id, direction: "in", text: "Oi! Vi a proposta de vocês, parece ótima. Consigo fechar com 10% de desconto no anual?", time: new Date(now - 3 * 3600000) },
      { organizationId: org.id, contactId: marina.id, direction: "out", senderId: ana.id, text: "Olá Marina! Consigo fazer 8% fechando até sexta. Te mando o novo valor?", time: new Date(now - 2.5 * 3600000) },
      { organizationId: org.id, contactId: marina.id, direction: "in", text: "Fechado, pode mandar 🙌", time: new Date(now - 2 * 3600000) },
      { organizationId: org.id, contactId: rafael.id, direction: "in", text: "Bom dia, o contrato para as 3 unidades já pode ser enviado para o jurídico.", time: new Date(now - 26 * 3600000) },
      { organizationId: org.id, contactId: rafael.id, direction: "out", senderId: carlos.id, text: "Bom dia Rafael! Vou preparar e envio até o fim do dia.", time: new Date(now - 25 * 3600000) },
      { organizationId: org.id, contactId: camila.id, direction: "in", text: "Recebi o acesso do upgrade, tudo certo por aqui, obrigada!", time: new Date(now - 40 * 3600000) },
    ],
  });

  console.log("Seed concluído.");
  console.log("Senhas geradas agora — anote, elas não são exibidas de novo:");
  console.log(`Login super-admin (painel /admin): admin@novacrm.com / ${adminPassword}`);
  console.log(`Login empresa demo (CRM normal): ana@novacrm.com / ${demoPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
