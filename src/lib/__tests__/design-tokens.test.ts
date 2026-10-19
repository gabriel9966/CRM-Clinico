import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guarda de acessibilidade do design system: lê os tokens reais de globals.css
// e exige contraste WCAG 2.2 AA nos pares que o produto usa.

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const root = css.match(/:root\{([\s\S]*?)\n\}/)?.[1] ?? "";

function token(name: string): string {
  const match = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --${name} não encontrado (ou não é #rrggbb) em :root`);
  return match[1];
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("design tokens — contraste WCAG AA", () => {
  const textPairs: [string, string][] = [
    ["text", "panel"], ["text", "bg"], ["text-soft", "panel"], ["text-soft", "bg"],
    ["text-faint", "panel"], ["text-faint", "bg"], ["text-faint", "surface-soft"], ["text-faint", "surface-muted"],
    ["accent-dark", "panel"], ["accent-dark", "accent-soft"],
    ["green", "panel"], ["green", "green-soft"], ["red", "panel"], ["red", "red-soft"],
    ["orange", "panel"], ["orange", "orange-soft"], ["blue", "panel"], ["blue", "blue-soft"],
    ["purple", "purple-soft"], ["primary", "panel"], ["primary", "primary-soft"],
    ["sidebar-text", "sidebar-bg"],
  ];
  it.each(textPairs)("texto --%s sobre --%s tem pelo menos 4.5:1", (fg, bg) => {
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("botão primário (branco sobre --primary) tem pelo menos 4.5:1", () => {
    expect(ratio("#ffffff", token("primary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("contorno de controle (--border-strong) e foco (--primary) têm pelo menos 3:1 sobre o painel", () => {
    expect(ratio(token("border-strong"), token("panel"))).toBeGreaterThanOrEqual(3);
    expect(ratio(token("primary"), token("panel"))).toBeGreaterThanOrEqual(3);
  });

  it("não define tipografia abaixo de 11px na escala", () => {
    const sizes = [...root.matchAll(/--fs-[a-z0-9]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });
});
