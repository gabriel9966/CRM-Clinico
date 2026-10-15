#!/bin/sh
set -e

# Migrations versionadas (prisma/migrations) no lugar do "prisma db push".
# O db push aplicava o schema direto e travava em qualquer aviso de "possível
# perda de dados" — foi o que derrubou um deploy. Aqui cada mudança é um
# arquivo SQL revisado e aplicado uma única vez, em ordem.
echo "[entrypoint] aplicando migrations (prisma migrate deploy)..."
if out=$(npx prisma migrate deploy 2>&1); then
  echo "$out"
else
  echo "$out"
  if echo "$out" | grep -q "P3005"; then
    # Banco que já existia antes das migrations (criado por db push): marca o
    # baseline como aplicado e segue. Só vale porque 0_init reproduz exatamente
    # o schema que esse banco já tem; se não bater, o deploy seguinte falha e o
    # container não sobe (nada é alterado às cegas).
    echo "[entrypoint] banco existente sem histórico: marcando 0_init como aplicado (baseline)..."
    npx prisma migrate resolve --applied 0_init
    npx prisma migrate deploy
  else
    echo "[entrypoint] ERRO: as migrations falharam — a aplicação NÃO vai subir."
    exit 1
  fi
fi

echo "[entrypoint] rodando seed (só popula se o banco estiver vazio)..."
npx tsx prisma/seed.ts || echo "[entrypoint] seed falhou ou já populado, seguindo..."

echo "[entrypoint] subindo a aplicação..."
exec "$@"
