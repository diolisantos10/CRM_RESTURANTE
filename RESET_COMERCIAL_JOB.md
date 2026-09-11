# Reset Comercial Job — Guia de Execução

## Visão Geral

Job temporário em Railway para executar `scripts/reset-comercial.ts` em **produção** em três modos controlados:

1. **Simular** (dry-run): Apenas contagens, nenhuma alteração
2. **Exportar**: Backup JSON em volume persistente + SHA256
3. **Apagar** (manual): Irreversível, requer confirmação explícita

## Segurança

✅ **DATABASE_URL** referenciada do serviço FOOCCI principal via `${{FOOCCI.DATABASE_URL}}`  
✅ **FOOCCI_SDR_SEND_ENABLED=false** para evitar mensagens  
✅ **Nenhum segredo** exposto no código do job  
✅ **Backup gravado em volume** separado e recuperável  
✅ **Serviço principal intacto** (startCommand não modificado)  
✅ **Job removível** após execução  

## Como Usar

### 1️⃣ Deploy do Job (após merge)

```bash
# No Railway dashboard:
# - O serviço "reset-comercial-job" aparecerá ao lado de FOOCCI
# - Está configurado com cronograma impossível (0 2 31 2 = nunca)
# - Volume /app/backups criado automaticamente
```

### 2️⃣ Executar Localmente (testes em staging/dev)

```bash
# Dentro do repo com NODE_ENV apropriado:
bash scripts/reset-comercial-job.sh
```

### 3️⃣ Executar em Produção via Railway

#### Via Railway Shell (recomendado):

```bash
# 1. Abra o shell do job no dashboard ou via CLI:
railway shell --service reset-comercial-job

# 2. Dentro do container:
cd /app
bash scripts/reset-comercial-job.sh

# 3. Verifique os modos 1 e 2 (simular + exportar):
#    - Logs na tela + arquivo em /app/backups/reset-comercial-*.log
#    - Backup JSON + .sha256 em /app/backups/

# 4. Se tudo ok, copie o SHA256 do backup:
cat /app/backups/leads-backup-*.sha256

# 5. Execute MANUALMENTE o apagar (copie-cole o comando abaixo com seu SHA256):
RESET_COMERCIAL_HABILITADO=sim \
MODO=apagar \
CONFIRMAR="APAGAR TODOS OS LEADS COMERCIAIS" \
SHA256="<cole-aqui-o-sha256>" \
npx tsx scripts/reset-comercial.ts
```

#### Via `railway run` (CLI):

```bash
# Execute tudo de uma vez (simular + exportar + apagar pausado):
railway run --service reset-comercial-job bash scripts/reset-comercial-job.sh

# Ou com apagar automático (CUIDADO!):
railway run --service reset-comercial-job \
  AUTO_DELETE=true \
  bash scripts/reset-comercial-job.sh
```

## Saídas e Artefatos

Após execução, seu volume `/app/backups` conterá:

```
/app/backups/
├── reset-comercial-20260911-154530.log    # Log completo (3 modos)
├── leads-backup-20260911-154530.json      # Backup em JSON
└── leads-backup-20260911-154530.json.sha256 # SHA256 do backup
```

**Você PODE:**
- ✅ Manter o backup indefinidamente (volume de 1GB)
- ✅ Download via Railway Files / CLI para auditoria
- ✅ Usar o SHA256 para verificação / documentação

**Você NÃO DEVE:**
- ❌ Modificar o JSON (o SHA256 não baterá)
- ❌ Apagar o backup antes de confirmar a integridade

## Removendo o Job

Após execução bem-sucedida:

```bash
# Via Railway dashboard:
# - Vá para "reset-comercial-job"
# - Clique em ⋮ (menu) → Remover Serviço
# - O volume também será removido (ou pode ser mantido para auditoria)
```

Ou via CLI:

```bash
railway remove --service reset-comercial-job
```

## Falhas e Rollback

Se algo der errado:

1. **Modo simular ou exportar falham** → Nenhum dado foi alterado
2. **Apagar falha** (antes de completar) → Verifique os logs, o backup está preservado
3. **Apagar foi completo** → Restaure do backup JSON (contate suporte ou DBA)

## Verificação Pós-Execução

```bash
# Dentro do shell do job:

# 1. Confirme o backup:
ls -lh /app/backups/leads-backup-*.json

# 2. Valide o JSON:
jq . /app/backups/leads-backup-*.json | head -20

# 3. Verifique o SHA256:
sha256sum /app/backups/leads-backup-*.json
cat /app/backups/leads-backup-*.sha256
```

## Variáveis de Ambiente (pré-configuradas)

| Variável | Valor | Propósito |
|----------|-------|----------|
| `DATABASE_URL` | `${{FOOCCI.DATABASE_URL}}` | Conexão ao DB produção |
| `FOOCCI_SDR_SEND_ENABLED` | `false` | Bloqueia envio de mensagens |
| `NODE_ENV` | `production` | Modo produção |
| `AUTO_DELETE` | `false` (padrão) | Requer confirmação manual para apagar |
| `BACKUP_DIR` | `/app/backups` | Onde gravar o backup |

## Dúvidas?

- Consulte `scripts/reset-comercial.ts` para os portões / validações
- Logs detalhados em `/app/backups/reset-comercial-*.log`
- Contate o CEO ou DBA se precisar restaurar o backup

