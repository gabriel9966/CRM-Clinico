---
name: novacrm
description: Regras, arquitetura e fluxo de trabalho do NovaCRM (CRM clínico multi-tenant — Next 16, React 19, Prisma 7, Postgres, Redis/BullMQ). Use ao implementar, corrigir, testar ou fazer deploy de qualquer coisa neste repositório — telas, server actions, migrations, permissões/escopo de dados, automações, agentes de IA, conexões (WhatsApp/Evolution/Instagram/Google) ou design system.
---

# NovaCRM — guia do projeto

CRM clínico multi-tenant (foco em estética; também odontologia e medicina). Produção: https://novacrm.kodexx.tech. Repositório git = esta pasta `web/` (a pasta `CRM` acima não é o repo).

## Antes de mexer
1. `git status` e `git log --oneline -5` — outras sessões trabalham no mesmo código.
2. Next 16 tem mudanças grandes: em dúvida, ler `node_modules/next/dist/docs/` (ver `AGENTS.md`). Middleware chama-se `src/proxy.ts`.
3. Nunca alterar a pasta `agenda-silva-glow` (somente leitura — portar a lógica, não o código).

## Arquitetura (onde fica cada coisa)
- Telas: `src/app/(app)/<módulo>/page.tsx` (server) + `src/components/<módulo>/*View.tsx` (client).
- Mutações: server actions em `src/app/<módulo>/actions.ts`. Leitura: `src/lib/queries.ts`, `src/lib/data.ts` (DTOs em `src/lib/types.ts`).
- Prisma: `src/lib/prisma.ts` (extensão com soft delete; `prismaRaw` ignora o filtro; tipos `TxClient`/`DbClient`).
- Erros de negócio: `AppError` em `src/lib/errors.ts`.
- Fila: BullMQ no container `worker` (`src/worker.ts`); no app `BACKGROUND_WORKER_ENABLED=false`. Rate limit compartilhado em `src/lib/shared-rate-limit.ts` (falha fechado em produção sem Redis).
- IA: `src/lib/ai/*` (SDK `@anthropic-ai/sdk`, laço manual de ferramentas, uso registrado em `AiUsage`). Docs: `docs/ai-agents.md`.
- Automações: `src/lib/automation/{types,engine}.ts`.
- Mensagens: toda mensagem sai por um canal real (`src/lib/messages.ts`, `src/lib/providers/*`); sem canal = recusa, nada gravado.

## Regras invioláveis
- **Multi-tenant:** toda consulta filtra `organizationId` da sessão. Nunca confiar em ids vindos do cliente sem conferir a organização.
- **Escopo de dados (carteira):** usar `getOwnerScope` / `assertOwnerInScope` (`src/lib/access.ts`) e `scopeWhere` / `ownerInScope` (`src/lib/access-scope.ts`) em toda listagem, busca, exportação e ação sobre contato/negócio/conversa. Acesso por pipeline (`UserPipelineAccess`) e por conexão (`UserConnectionAccess`) também. Permissões de módulo em `src/lib/access-policy.ts` (`MODULE_PERMISSIONS`). Esconder link no menu não basta — conferir no servidor.
- **Somente ADMIN:** equipe, conexões, automações, MCP, campanhas, tags, lixeira, auditoria, agentes de IA.
- **Nenhuma tela carrega "todos os registros":** paginação por cursor.
- **Migrations versionadas** (`npx prisma migrate dev --create-only` + revisar SQL). Nunca `db push`. Prefixo de data maior que o da última migration existente. Depois: `npx prisma generate`.
- Dados de saúde → LGPD: auditoria (`src/lib/audit.ts`) em ações sensíveis.
- Nunca ler/copiar/commitar segredos do `.env`. Nunca force-push.

## Convenções de código
- Comentários em português, curtos, explicando o porquê. Seguir o estilo do arquivo vizinho.
- Arquivos usam **CRLF**. Editar com Edit/Write (não com `sed`/PowerShell `Set-Content`, que quebra encoding/BOM).
- React 19: `useActionState` limpa campos não controlados após a ação — campos que devem sobreviver a erro são controlados.
- CSS: tokens em `:root` de `src/app/globals.css` (`--surface*`, `--text*`, `--border*`, `--fs-*`, `--space-*`, `--radius-*`, `--control-h`). Não usar cores soltas. Guia: `docs/design-system.md`. O teste `src/lib/__tests__/design-tokens.test.ts` exige contraste AA.
- Em selects, usar `background-color` (o shorthand `background` apaga a seta).

## Validar (antes de dizer que terminou)
```bash
npx tsc --noEmit
npm run lint
npx vitest run                 # unitários
npx next build                 # pega erros que tsc/vitest não pegam
```
- Integração com Postgres real: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/<db> DB_POOL_MAX=5 npx vitest run` (sem a variável os `*.int.test.ts` são pulados).
- Testar no navegador: `next dev` em `localhost` (`next start` sem Redis bloqueia o login).
- CSS servido desatualizado → parar o dev, apagar `.next`, subir de novo.

## Deploy (somente quando o usuário pedir)
- VPS compartilhada (Supabase, n8n, Evolution): mexer só em `novacrm-uann-*` em `/docker/novacrm-uann`. SSH só com a chave `~/.ssh/crm_hostinger`.
- Fluxo: backup (`pg_dump` do schema `public` + tar do app) → `git archive --format=tar.gz HEAD` → scp → extrair → `docker compose up -d --build app worker`. Nunca enviar/sobrescrever o `.env` de produção, `node_modules`, `.next`, `dev.db`.
- Comandos remotos: escrever um `.sh` no scratchpad e rodar `ssh ... 'bash -s' < arquivo.sh` (PowerShell estraga aspas).
- Depois: conferir `prisma migrate status`, logs do container e login na URL de produção.

## Commits
- Mensagem curta em português, no imperativo/descritiva, dizendo o efeito para o usuário.
- No PowerShell, usar `git commit -F arquivo` (here-string com `-m` falha em silêncio).
