# CRM Clínico

CRM multi-empresa (multi-tenant) para clínicas — estética em primeiro lugar, com a base pronta para odontologia e medicina. Next.js 16 · React 19 · Prisma 7 · PostgreSQL · Redis (fila das automações).

## O que tem

- **Contatos, pipeline (kanban), tarefas e conversas** (WhatsApp via Evolution API, Instagram e e-mail), com **automações** visuais e fila.
- **Agenda clínica**: profissionais, salas, procedimentos, bloqueios (pontuais e recorrentes), disponibilidade, reserva com idempotência, remarcar, cancelar e registrar falta. Tudo também pela **API REST `/api/v1`** e por **ferramentas MCP** (para um assistente de IA agendar).
- **Catálogos**: etiquetas, motivos de perda, itens/produtos do negócio (valor = soma dos itens).
- **Lixeira** (restaurável) e **auditoria** (quem fez o quê) — só administradores.

## Rodando localmente

```bash
npm install
cp .env.production.example .env      # preencha DATABASE_URL e os segredos
npx prisma migrate deploy            # cria/atualiza as tabelas
npx tsx prisma/seed.ts               # dados de demonstração (senhas aleatórias, impressas uma vez)
npm run dev
```

Precisa de um PostgreSQL. Redis é opcional em desenvolvimento (sem ele as automações com "Espera" usam um modo de segurança).

## Banco de dados e migrations

O schema vive em `prisma/schema.prisma` e **toda mudança vira um arquivo em `prisma/migrations/`** (SQL revisado, aplicado uma vez, em ordem). Não use `prisma db push` em produção: ele aplica o schema às cegas e trava em avisos de "possível perda de dados" — foi o que derrubou um deploy.

```bash
# alterou o schema? gere a migration (banco de desenvolvimento):
npx prisma migrate dev --name o_que_mudou
# produção / container: já roda sozinho no docker-entrypoint.sh
npx prisma migrate deploy
```

- `0_init` é o *baseline*: reproduz o schema de bancos criados antes das migrations. O entrypoint do Docker marca essa migration como aplicada em bancos que já existiam e aplica o resto. Se a migration falhar, **a aplicação não sobe** (nada é alterado às cegas).
- Faça backup antes de migrations em produção.
- Para conferir que o banco e o schema estão iguais: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.

## Testes

```bash
npm test                 # unitários (rápidos, com banco simulado)
npx tsc --noEmit         # tipos
npm run lint
```

**Testes de integração com PostgreSQL de verdade** (lixeira, concorrência de reservas, paginação, agregações, segmentos…) só rodam se houver um banco descartável com as migrations aplicadas:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/crm_test \
DB_POOL_MAX=5 npm test
```

Nunca aponte `TEST_DATABASE_URL` para um banco com dados reais: os testes criam e apagam organizações de teste.

## Regras que o código segue (não quebre)

- **Isolamento multi-tenant**: toda consulta filtra por `organizationId`. Ids que chegam do navegador ou da API (contato, etapa, responsável…) são conferidos contra a organização antes de qualquer gravação.
- **Lixeira**: `Contact`, `Opportunity` e `Appointment` têm `deletedAt`. O cliente `prisma` (em `lib/prisma.ts`) **filtra automaticamente** o que está na lixeira e **recusa `delete`/`deleteMany`** nesses modelos. Para apagar use `lib/soft-delete.ts`; para restaurar/apagar de vez, `lib/trash.ts`. Consultas `$queryRaw` não passam pelo filtro: inclua `"deletedAt" IS NULL` à mão.
- **Nenhuma tela carrega "todos os registros"**: listas vêm paginadas por cursor (`lib/queries.ts`), números de painel vêm de agregações no banco e seletores buscam por digitação (`EntityPicker`).
- **Mensagens** só são criadas por `lib/messages.ts` (`createMessage`), que mantém o resumo da última mensagem do contato usado na lista de conversas.
- **Permissões**: ações e páginas de administração (equipe, conexões, automações, chave da API, lixeira, auditoria) usam `requireAdminUser`/`requireAdminPage`. Esconder um botão não basta — server actions podem ser chamadas direto.
- **Auditoria**: exclusões, restaurações, exportações e mudanças de agenda gravam em `AuditLog` (`lib/audit.ts`).
- **Segredos**: nunca no código nem no `.env.production.example` (há um teste que barra).

## Segurança operacional

| Item | Como funciona |
|---|---|
| Login | limite de 5 tentativas por e-mail / 30 por IP a cada 15 min |
| API `/api/v1` e `/api/mcp` | chave Bearer por empresa (guardada cifrada, localizada por hash); limite por IP e por empresa |
| Webhooks | URL com `?token=` (HMAC derivado de `CONNECTIONS_SECRET`) + limite por origem; Instagram confere a assinatura da Meta (`INSTAGRAM_APP_SECRET`) |
| Migração dos webhooks | URLs antigas (sem token) seguem valendo até `WEBHOOK_REQUIRE_TOKEN=true`; use **Conexões → Atualizar webhook** |
| Exportações CSV | em fluxo (memória constante), com proteção contra injeção de fórmula em planilhas |

O limitador de tentativas é **por processo** (em memória). Com mais de uma réplica do app, troque por Redis.

Redefinir a senha de um usuário: `npx tsx prisma/reset-password.ts email@exemplo.com [novaSenha]`.

## Deploy (Docker)

`docker compose up -d --build app` — o `docker-entrypoint.sh` aplica as migrations, roda o seed (só se o banco estiver vazio) e sobe o app. Variáveis em `.env` (veja `.env.production.example`).
