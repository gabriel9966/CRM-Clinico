import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// O .env.production.example é versionado. Já aconteceu de ele ser preenchido
// com os segredos REAIS de produção — este teste impede que valores que pareçam
// segredo entrem nele de novo.
const file = path.resolve(__dirname, "../../../.env.production.example");

function parse(text: string) {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return out;
}

describe(".env.production.example", () => {
  const env = existsSync(file) ? parse(readFileSync(file, "utf8")) : {};

  it("existe e documenta as variáveis obrigatórias", () => {
    expect(existsSync(file)).toBe(true);
    for (const key of ["DATABASE_URL", "SESSION_SECRET", "CONNECTIONS_SECRET", "APP_BASE_URL"]) {
      expect(env, key).toHaveProperty(key);
    }
  });

  it("não contém nada que pareça segredo real (só placeholders ou vazio)", () => {
    const sensitive = Object.entries(env).filter(([k]) => /SECRET|TOKEN|KEY|PASSWORD|SENHA/.test(k));
    expect(sensitive.length).toBeGreaterThan(0);
    for (const [k, v] of sensitive) {
      const placeholder = v === "" || /^troque/i.test(v);
      expect(placeholder, `${k} parece ter um valor real`).toBe(true);
    }
  });

  it("DATABASE_URL não traz senha de verdade", () => {
    expect(env.DATABASE_URL).toMatch(/USUARIO:SENHA@/);
  });

  it("nenhum valor longo e aleatório (estilo segredo) em qualquer variável", () => {
    for (const [k, v] of Object.entries(env)) {
      if (k === "DATABASE_URL" || k === "APP_BASE_URL" || k === "REDIS_URL") continue;
      expect(/^[A-Za-z0-9_\-]{30,}$/.test(v) && !/^troque/i.test(v), `${k} parece um segredo`).toBe(false);
    }
  });
});
