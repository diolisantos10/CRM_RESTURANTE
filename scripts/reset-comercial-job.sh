#!/bin/bash
set -e

# Reset Comercial Job — Orquestrador dos 3 modos (simular, exportar, apagar)
# Para execução post-deploy em produção com DATABASE_URL já injetada
# Não expõe segredos, mantém backups em volume, pronto para remoção manual

BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
LOG_FILE="${BACKUP_DIR}/reset-comercial-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$BACKUP_DIR"

echo "=== Reset Comercial Job ===" | tee "$LOG_FILE"
echo "Início: $(date -u '+%Y-%m-%d %H:%M:%S UTC')" | tee -a "$LOG_FILE"
echo "Database: ${DATABASE_URL:0:20}..." | tee -a "$LOG_FILE"
echo "FOOCCI_SDR_SEND_ENABLED: $FOOCCI_SDR_SEND_ENABLED" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# MODO 1: SIMULAR (dry-run, apenas contagens)
echo "[1/3] SIMULAÇÃO (dry-run)" | tee -a "$LOG_FILE"
echo "──────────────────────────" | tee -a "$LOG_FILE"
MODO=simular npx tsx scripts/reset-comercial.ts 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# MODO 2: EXPORTAR (grava backup JSON e SHA256)
echo "[2/3] EXPORTAÇÃO (backup)" | tee -a "$LOG_FILE"
echo "────────────────────────" | tee -a "$LOG_FILE"
BACKUP_FILE="${BACKUP_DIR}/leads-backup-$(date +%Y%m%d-%H%M%S).json"
export BACKUP_FILE
MODO=exportar npx tsx scripts/reset-comercial.ts 2>&1 | tee -a "$LOG_FILE"

if [ -f "$BACKUP_FILE" ]; then
  SHA256=$(sha256sum "$BACKUP_FILE" | awk '{print $1}')
  echo "✓ Backup gravado: $BACKUP_FILE" | tee -a "$LOG_FILE"
  echo "SHA256: $SHA256" | tee -a "$LOG_FILE"
  echo "$SHA256" > "${BACKUP_FILE}.sha256"
  echo "SHA256 salvo em: ${BACKUP_FILE}.sha256" | tee -a "$LOG_FILE"
else
  echo "⚠ Nenhum backup gerado. Verifique os logs acima." | tee -a "$LOG_FILE"
  exit 1
fi
echo "" | tee -a "$LOG_FILE"

# MODO 3: APAGAR (requer confirmação e SHA256)
echo "[3/3] APAGAR (IRREVERSÍVEL)" | tee -a "$LOG_FILE"
echo "───────────────────────────" | tee -a "$LOG_FILE"
echo "⚠  Este passo APAGA PERMANENTEMENTE todos os dados de leads e base fria." | tee -a "$LOG_FILE"
echo "⚠  Backup preservado em: $BACKUP_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Se rodar em CI/CD, o comando abaixo deve ser executado MANUALMENTE com:
# RESET_COMERCIAL_HABILITADO=sim \
# MODO=apagar \
# CONFIRMAR="APAGAR TODOS OS LEADS COMERCIAIS" \
# SHA256=$SHA256 \
# npx tsx scripts/reset-comercial.ts

if [ "$AUTO_DELETE" = "true" ]; then
  echo "Executando apagar automático (AUTO_DELETE=true)..." | tee -a "$LOG_FILE"
  RESET_COMERCIAL_HABILITADO=sim \
  MODO=apagar \
  CONFIRMAR="APAGAR TODOS OS LEADS COMERCIAIS" \
  SHA256="$SHA256" \
  npx tsx scripts/reset-comercial.ts 2>&1 | tee -a "$LOG_FILE"
else
  echo "⏸  Apagar está PAUSADO. Para executar, rode:" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  echo "  RESET_COMERCIAL_HABILITADO=sim \\" | tee -a "$LOG_FILE"
  echo "  MODO=apagar \\" | tee -a "$LOG_FILE"
  echo "  CONFIRMAR=\"APAGAR TODOS OS LEADS COMERCIAIS\" \\" | tee -a "$LOG_FILE"
  echo "  SHA256=\"$SHA256\" \\" | tee -a "$LOG_FILE"
  echo "  npx tsx scripts/reset-comercial.ts" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "=== Fim ===" | tee -a "$LOG_FILE"
echo "Log completo em: $LOG_FILE" | tee -a "$LOG_FILE"

