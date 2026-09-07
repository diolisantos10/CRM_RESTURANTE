#!/usr/bin/env bash
set -u

echo "=================================================="
echo "FOOCCI EMERGENCY MIGRATION RECOVERY START"
echo "=================================================="

echo "Step 1: resolving failed migration as rolled back if needed..."
npx prisma migrate resolve --rolled-back 20260518000001_add_distance_min_fee_km || true

echo "Step 2: running prisma migrate deploy..."
npx prisma migrate deploy

echo "Step 3: scheduling manual guides self-seed (background)..."
# Keeps the lojista help guides in sync with the code on every deploy:
# once the server is up, upsert the code-defined guides into the DB
# (idempotent, published + agent-visible). Never blocks or fails the boot.
if [ -n "${ADMIN_SECRET:-}" ]; then
  (
    for delay in 30 45 60; do
      sleep "$delay"
      STATUS=$(curl --max-time 30 -s -o /tmp/seed-howtos.json -w "%{http_code}" \
        -X POST "http://localhost:${PORT:-3000}/api/admin/manual/seed-howtos" \
        -H "x-admin-secret: ${ADMIN_SECRET}" || echo "000")
      echo "[manual-sync] seed-howtos attempt → HTTP ${STATUS}"
      if [ "$STATUS" = "200" ]; then
        echo "[manual-sync] guides synced: $(cat /tmp/seed-howtos.json 2>/dev/null)"
        break
      fi
    done
  ) &
else
  echo "[manual-sync] ADMIN_SECRET not set — skipping guides self-seed."
fi

echo "Step 4: scheduling Foocci Bakery showcase self-seed (background)..."
# Keeps the demo bakery (the showcase restaurant of the sales site) in sync with
# the code on every deploy: once the server is up, upsert the 40-item menu and
# fire the photos that are still missing. Idempotent — never regenerates a photo
# that already exists. Runs in a background subshell AFTER `next start`, so it
# can neither block nor break the boot: a site down because of a demo bakery
# would be far worse than the bakery missing.
if [ -n "${ADMIN_SECRET:-}" ]; then
  (
    for delay in 40 60 90; do
      sleep "$delay"
      STATUS=$(curl --max-time 120 -s -o /tmp/seed-bakery.json -w "%{http_code}" \
        -X POST "http://localhost:${PORT:-3000}/api/admin/demo-bakery/self-seed" \
        -H "x-admin-secret: ${ADMIN_SECRET}" || echo "000")
      echo "[bakery-sync] self-seed attempt → HTTP ${STATUS}"
      if [ "$STATUS" = "200" ]; then
        echo "[bakery-sync] showcase bakery synced: $(cat /tmp/seed-bakery.json 2>/dev/null)"
        break
      fi
      echo "[bakery-sync] not ready yet: $(cat /tmp/seed-bakery.json 2>/dev/null)"
    done
  ) &
else
  echo "[bakery-sync] ADMIN_SECRET not set — skipping bakery self-seed."
fi

echo "Step 5: scheduling Sala de Vendas self-seed (background)..."
# A Sala precisa do catálogo de motivos de perda para funcionar: sem ele
# NENHUM lead pode ser marcado como perdido, porque a regra do funil exige
# motivo estruturado — e o catálogo nasce vazio. Até 25/08/2026 a única forma
# de semear era `npm run db:seed-sala`, ou seja, terminal no ambiente.
#
# Idempotente, e deliberadamente conservadora: NÃO cria lead nenhum (base
# comercial não recebe dado falso) e NÃO liga o TA — ele nasce desligado e a
# semeadura não o religa. Ligar é ato humano, das duas direções.
#
# Mesmo molde dos dois passos acima, e pelo mesmo motivo: roda depois do boot,
# em subshell, para não poder bloquear nem derrubar a subida.
if [ -n "${ADMIN_SECRET:-}" ]; then
  (
    for delay in 35 50 70; do
      sleep "$delay"
      STATUS=$(curl --max-time 30 -s -o /tmp/seed-sala.json -w "%{http_code}" \
        -X POST "http://localhost:${PORT:-3000}/api/admin/sala-de-vendas/seed" \
        -H "x-admin-secret: ${ADMIN_SECRET}" || echo "000")
      echo "[sala-sync] seed attempt → HTTP ${STATUS}"
      if [ "$STATUS" = "200" ]; then
        echo "[sala-sync] Sala semeada: $(cat /tmp/seed-sala.json 2>/dev/null)"
        break
      fi
    done
  ) &
else
  echo "[sala-sync] ADMIN_SECRET not set — skipping Sala self-seed."
fi

echo "Step 6: scheduling declared-access self-seed (background)..."
# Concede os acessos DECLARADOS no repositorio (src/services/organizacao/
# acessosDeclarados.ts) e manda a senha provisoria para a caixa do Dioli Connect
# de cada um — de maquina para maquina, sem ninguem ler a senha na tela.
#
# Ordem do CEO em 06/09/2026: conceder acesso nao pode depender de alguem
# lembrar de abrir uma tela. Nenhuma credencial nova nasce disto: quem age e a
# plataforma, com o ADMIN_SECRET que ja vive aqui dentro.
#
# ⚠️ Idempotente e conservadora: NUNCA troca a senha de quem ja existe (senao
# todo deploy expulsaria a pessoa da propria conta) e NUNCA desliga ninguem.
#
# Mesmo molde dos tres passos acima, e pelo mesmo motivo: depois do boot, em
# subshell, para nao poder bloquear nem derrubar a subida.
if [ -n "${ADMIN_SECRET:-}" ]; then
  (
    for delay in 25 40 60; do
      sleep "$delay"
      STATUS=$(curl --max-time 30 -s -o /tmp/seed-acessos.json -w "%{http_code}" \
        -X POST "http://localhost:${PORT:-3000}/api/admin/acessos/self-seed" \
        -H "x-admin-secret: ${ADMIN_SECRET}" || echo "000")
      echo "[acessos-sync] self-seed attempt → HTTP ${STATUS}"
      if [ "$STATUS" = "200" ]; then
        echo "[acessos-sync] acessos aplicados: $(cat /tmp/seed-acessos.json 2>/dev/null)"
        break
      fi
    done
  ) &
else
  echo "[acessos-sync] ADMIN_SECRET not set — skipping declared-access self-seed."
fi

echo "Step 7: starting Next.js..."
npx next start
