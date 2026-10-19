import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";

if (!process.env.DATABASE_URL?.endsWith("/crm_validation")) throw new Error("Smoke tests only run on the disposable crm_validation database.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const password = randomBytes(20).toString("hex");
const prefix = `smoke-${Date.now()}`;
let orgId;
let server;
let browser;
const pageErrors = [];
const log = [];
try {
  orgId = (await db.organization.create({ data: { name: "Empresa de validação", slug: prefix } })).id;
  const admin = await db.user.create({ data: { organizationId: orgId, name: "Admin de validação", email: `${prefix}@test.local`, passwordHash: await bcrypt.hash(password, 10), role: "ADMIN" } });
  const member = await db.user.create({ data: { organizationId: orgId, name: "Sem permissões", email: `${prefix}-member@test.local`, passwordHash: await bcrypt.hash(password, 10) } });
  const contact = await db.contact.create({ data: { organizationId: orgId, name: "Cliente de validação", phone: "+5511999999999", ownerId: admin.id } });
  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "Vendas de validação", stages: { create: [{ label: "Entrada", order: 0, color: "#64748b" }, { label: "Ganho", order: 1, color: "#16a34a", status: "WON" }] } }, include: { stages: true } });
  await db.opportunity.create({ data: { organizationId: orgId, title: "Proposta de validação", pipelineId: pipeline.id, stageId: pipeline.stages[0].id, contactId: contact.id, value: 500, ownerId: admin.id } });
  const connection = await db.connection.create({ data: { organizationId: orgId, label: "WhatsApp oficial de validação", provider: "WHATSAPP_CLOUD", status: "CONNECTED" } });
  const time = new Date(Date.now() - 25 * 3600_000);
  const conversation = await db.conversation.create({ data: { organizationId: orgId, contactId: contact.id, connectionId: connection.id, ownerId: admin.id, lastMessageAt: time, lastMessageText: "Olá", lastMessageDirection: "in" } });
  await db.message.create({ data: { organizationId: orgId, contactId: contact.id, connectionId: connection.id, conversationId: conversation.id, text: "Olá", direction: "in", time } });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3217"], { env: { ...process.env, NODE_ENV: "production", BACKGROUND_WORKER_ENABLED: "false", REDIS_URL: "redis://127.0.0.1:6399" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (data) => log.push(data.toString()));
  server.stderr.on("data", (data) => log.push(data.toString()));
  const base = "http://localhost:3217";
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, "Application did not start");
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 500) pageErrors.push(`${response.status()} ${response.url()}`); });
  const login = async (email) => {
    await page.goto(`${base}/login`);
    await page.locator('[name="email"]').fill(email);
    await page.locator('[name="password"]').fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL("**/dashboard");
  };
  await login(admin.email);
  for (const path of ["dashboard", "contacts", "pipeline", "activities", "appointments", "connections", "automations", "ai", "team", "tags", "custom-fields", "audit", "account"]) {
    const response = await page.goto(`${base}/${path}`);
    assert(response?.ok(), `${path} failed`);
    await page.locator("h1").first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `${path} overflows the desktop viewport`);
  }
  await page.goto(`${base}/conversations?conversation=${conversation.id}`);
  await page.getByRole("button", { name: "Enviar template oficial", exact: true }).click();
  await page.getByRole("heading", { name: "Enviar template oficial", exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Nota privada · só eu", exact: true }).click();
  await page.locator('.thread-input input').fill("Anotação privada de validação");
  await page.locator('.thread-input button[type="submit"]').click();
  await page.getByText("Anotação privada de validação", { exact: true }).waitFor();
  assert.equal(await db.conversationPrivateNote.count({ where: { conversationId: conversation.id } }), 1);
  const newConversationBox = await page.getByRole("button", { name: "Novo atendimento", exact: true }).boundingBox();
  assert(newConversationBox && newConversationBox.y >= 0, "New conversation action is clipped");
  await page.screenshot({ path: `${process.env.SMOKE_ARTIFACTS_DIR || "/tmp"}/novacrm-conversations-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/contacts`);
  await page.locator("h1").first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "contacts overflows the mobile viewport");
  for (const button of await page.locator(".topbar button, .topbar a.btn").all()) {
    const box = await button.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 392, "Mobile header action is outside the viewport");
  }
  await page.screenshot({ path: `${process.env.SMOKE_ARTIFACTS_DIR || "/tmp"}/novacrm-contacts-mobile.png`, fullPage: true });
  await context.clearCookies();
  await login(member.email);
  await page.goto(`${base}/contacts`);
  await page.getByText("Você não tem acesso a este módulo. Solicite a liberação ao administrador.", { exact: true }).waitFor();
  assert.equal(await page.getByText(contact.name, { exact: true }).count(), 0);
  await context.clearCookies();
  await page.goto(`${base}/forgot-password`);
  await page.getByRole("heading", { name: "Recuperar acesso" }).waitFor();
  assert.deepEqual(pageErrors, [], "Browser errors");
  console.log("SMOKE_OK: 13 modules, desktop/mobile layout, login, permissions, private note, official template dialog, recovery screen.");
} catch (error) {
  console.error(log.join("\n"));
  throw error;
} finally {
  await browser?.close();
  server?.kill();
  if (orgId) await db.organization.delete({ where: { id: orgId } });
  await db.$disconnect();
}
