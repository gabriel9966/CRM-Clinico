# Design system do NovaCRM

Fonte da verdade: os tokens no topo de `src/app/globals.css`. Componentes novos usam
os tokens, nunca valores soltos (`#fff`, `13px`, `10px` de raio…).

## Princípios

1. **Acessível por padrão (WCAG 2.2 AA).** Texto normal ≥ 4,5:1; texto grande, bordas de
   controles e ícones ≥ 3:1; foco sempre visível; alvos de toque confortáveis.
2. **Denso, calmo e neutro.** CRM é ferramenta de trabalho diário: superfícies neutras, cor de
   marca só em elementos interativos/ativos, nada de "levitar" no hover.
3. **Hierarquia por tipografia e espaço**, não por sombra. Cartões usam borda; sombra é só para
   o que flutua (menus, popovers, modais).
4. **Estado nunca só por cor.** Atraso, erro e sucesso levam texto ou ícone junto.

## Tokens

| Grupo | Tokens | Regra |
| --- | --- | --- |
| Superfície | `--bg` `--panel` `--surface-soft` `--surface-muted` | página, cartão, faixa de cabeçalho/rodapé, campo desabilitado |
| Borda | `--border-soft` `--border` `--border-strong` | divisória leve · contorno de cartão · contorno de controle (3:1) |
| Texto | `--text` `--text-soft` `--text-faint` | todos ≥ 4,5:1 sobre `--panel` e `--bg`. `--text-faint` é o mais claro permitido |
| Marca | `--primary` `--accent` `--accent-dark` | `--accent` só preenche; texto verde usa `--accent-dark`/`--green` |
| Estado | `--green` `--red` `--orange` `--blue` `--purple` + `-soft` | texto do estado sobre o respectivo `-soft` é AA |
| Tipografia | `--fs-xs 11` `--fs-sm 12` `--fs-base 13` `--fs-md 14` `--fs-lg 16` `--fs-xl 20` `--fs-2xl 24` | nunca abaixo de 11px; números com `tabular-nums` |
| Espaço | `--space-1…10` (4, 8, 12, 16, 20, 24, 32, 40) | grade de 4px |
| Forma | `--radius-sm 6` `--radius-ctl 8` `--radius 10` `--radius-lg 14` | controles 8, cartões 10, modais 14 |
| Altura | `--control-h 36` `--control-h-sm 30` | botões, campos e abas alinhados |
| Elevação | `--shadow` `--shadow-sm` `--shadow-md` `--shadow-lg` | md = menus/popovers, lg = modais |
| Movimento | `--dur-fast .12s` `--dur .18s` `--ease` | respeita `prefers-reduced-motion` |

## Componentes

- **Botão** (`.btn`): 36px; `.small` 30px; variantes `.primary`, `.ghost`, `.danger`. Um primário por
  tela/contexto. Foco = contorno de 2px em `--focus-color`.
- **Campo** (`.field`): rótulo 12px/600 acima; controle 36px; foco = borda `--primary` + anel;
  erro = `aria-invalid="true"` + `.field-error` com texto. Inputs/selects soltos herdam a mesma base.
- **Tabela** (`.table-wrap` + `table`): cabeçalho 40px, linhas 48px, divisórias leves, hover sutil,
  números tabulares.
- **Cartão** (`.stat-card`, `.dash-stat`, `.deal-card`…): borda `--border`, raio `--radius`,
  sombra mínima. Sem animação de levitar.
- **Modal** (`.modal`): cabeçalho e rodapé separados por borda; rodapé em `--surface-soft`.
- **Pílula/tag** (`.pill`, `.tag`): 12px/600, raio total.

## Checklist para telas novas

- [ ] Só tokens (sem hex, sem px soltos fora da escala).
- [ ] Contraste conferido (4,5:1 texto, 3:1 controles).
- [ ] Navegável por teclado, foco visível.
- [ ] Estados vazio, carregando e erro com texto claro.
- [ ] Funciona em 360px de largura.

## Próximos passos sugeridos

- Tema escuro: os tokens semânticos já separam papel de valor; falta migrar os `style={{…}}` inline
  dos componentes para tokens.
- Extrair componentes React (`Button`, `Field`, `Badge`) para substituir classes repetidas.
