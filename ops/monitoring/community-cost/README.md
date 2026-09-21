# Community Cost Operations

Esta pasta versiona o contrato operacional de custo de Comunidades. Ela não
contém preço comercial e não converte proxies técnicos em custo financeiro.

## Validar o contrato

```bash
npm run community:cost-operations:check
```

A validação também faz syntax-check dos scripts administrativos e executa um
dry-run do provisioning de Monitoring.

## Aplicar dashboard e alertas

Pré-requisitos:

- `gcloud` autenticado no projeto correto;
- APIs de Cloud Logging e Cloud Monitoring habilitadas;
- permissão para gerenciar log-based metrics, dashboards e alert policies;
- ao menos um notification channel para uso real.

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
