# Community Cost Operations

Esta pasta versiona o contrato operacional de custo de Comunidades. Ela não
contém preço comercial e não converte proxies técnicos em custo financeiro.

## Validar o contrato

```bash
npm run community:cost-operations:check
```

A validação também faz syntax-check dos scripts administrativos e executa um
dry-run do provisioning de Monitoring.

## Operação pelo GitHub Actions

A operação real deve usar os workflows manuais:

- `.github/workflows/community-cost-monitoring-production.yml`;
- `.github/workflows/community-cost-baseline-production.yml`.

Eles usam **Workload Identity Federation/OIDC** e não aceitam chave JSON
persistente no repositório.

Repository variables esperadas:

- `GCP_COMMUNITY_COST_WORKLOAD_IDENTITY_PROVIDER` — resource name completo
  do provider WIF;
- `GCP_COMMUNITY_COST_SERVICE_ACCOUNT` — service account usado pelo domínio
  de observabilidade de custo;
- `COMMUNITY_COST_NOTIFICATION_CHANNEL` — opcional quando o channel for
  informado manualmente no dispatch do workflow de Monitoring.

O principal do workflow de Monitoring precisa, no projeto de produção, de
permissões equivalentes a:

- `roles/logging.configWriter` para métricas baseadas em logs;
- `roles/monitoring.dashboardEditor` para dashboard;
- `roles/monitoring.alertPolicyEditor` para alert policies;
- permissão `serviceusage.services.use` quando exigida pelo uso de `gcloud`.

Para a captura do baseline, o principal precisa apenas de leitura suficiente
dos logs de produção, além do uso do serviço via CLI. Não conceder papéis de
edição se o mesmo principal puder ser separado em uma identidade read-only.

O workflow de Monitoring inicia em `dry_run=true`. A aplicação real exige
explicitamente `dry_run=false` e um notification channel válido.

O workflow de baseline é exclusivamente manual e recusa `days < 14`. Ele
faz upload do JSON como artifact temporário; o baseline não é commitado no Git.

## Aplicar dashboard e alertas

Pré-requisitos para execução local:

- `gcloud` autenticado no projeto correto;
- APIs de Cloud Logging e Cloud Monitoring habilitadas;
- permissão para gerenciar log-based metrics, dashboards e alert policies;
- ao menos um notification channel para uso real.

No GitHub Actions, preferir o workflow manual descrito acima em vez de chave
de service account armazenada como secret.

```bash
npm run community:cost-monitoring:apply -- \
  --project=entretenimento-sexual \
  --notification-channel=projects/entretenimento-sexual/notificationChannels/CHANNEL_ID
```

Para inspecionar os comandos sem alterar o projeto:

```bash
npm run community:cost-monitoring:apply -- \
  --project=entretenimento-sexual \
  --dry-run
```

O provisioning é idempotente por nome canônico.

## Capturar baseline real

Depois que a instrumentação estiver em produção por pelo menos 14 dias:

```bash
npm run community:cost-baseline:capture -- \
  --project=entretenimento-sexual \
  --days=14
```

Saída padrão:

`./.dev-logs/community-cost-baseline.json`

A captura consulta os eventos estruturados de produção e calcula a agregação
canônica de cada métrica. Se uma consulta atingir o limite de entradas, o script
falha em vez de produzir baseline truncado. O limite pode ser aumentado com
`--max-entries=N`.

## O que o baseline libera

O baseline, sozinho, não muda produto nem preço.

Business/Official ainda exige:

- oferta apresentada;
- conversão real;
- Comunidades realmente criadas;
- custo realizado vindo de `cloud_billing_export` ou
  `finance_actual_allocation`.

Community Boost ainda exige:

- placements realmente servidos;
- custo financeiro efetivamente atribuído ao domínio patrocinado;
- baseline operacional pronto.

Somente depois desses gates a análise comercial pode retornar
`canCalibrateCommercialOffer=true` ou `canCalibrateBoostCost=true`.

## Fora do baseline real

`community.discovery.callables_per_session` continua client/synthetic. Não
criar documento, hash ou write de sessão no backend apenas para observar custo.

Cloud Billing Budget também permanece separado deste contrato. O valor mensal
é uma decisão financeira do produto/empresa e precisa ser informado no ambiente
de billing, não inferido do código.
