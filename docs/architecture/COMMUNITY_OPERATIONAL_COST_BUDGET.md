# Orçamento operacional de custo — Comunidades

## Objetivo

Este documento define o orçamento operacional de custo de Comunidades **antes de qualquer otimização**. O objetivo é impedir duas falhas comuns:

1. otimizar por intuição sem evidência de custo real;
2. descobrir crescimento de custo apenas pela fatura.

A fonte canônica executável dos thresholds é:

`functions/src/shared/observability/operational-cost-budget.policy.ts`

Os valores abaixo são **unidades operacionais**, não uma simulação de billing do Firebase/Google Cloud. Preços, free tiers, edição e região podem mudar. O runtime não deve incorporar preços monetários.

## Princípios

- medir com dados que o caminho já possui;
- não adicionar reads, writes ou identificadores de sessão apenas para medir custo;
- distinguir proxy operacional de cobrança real;
- alertar primeiro, investigar depois, otimizar somente com evidência;
- não degradar segurança, autorização, privacidade ou consistência para economizar;
- não desligar billing automaticamente por atingir um threshold de alerta;
- manter o orçamento canônico versionado e testado.

### Relação com Business/Official

Este orçamento mede proxies operacionais e envelopes técnicos. Ele **não** calcula preço de plano nem custo financeiro em BRL. Para calibrar monetização/capacidade Business/Official, o campo `actualCostCents` deve vir de custo realizado em billing/finanças e ser combinado com oferta apresentada, conversão e quantidade de Comunidades criadas. Sem esses quatro sinais reais, a configuração comercial não deve ser reajustada por estimativa.

## Orçamento canônico

| Dimensão | Target | Warning | Critical | Agregação / janela | Fonte |
| --- | ---: | ---: | ---: | --- | --- |
| Discovery reads/card | ≤ 2,5 | > 3,5 | > 5,0 | p95 / 15 min, mínimo 100 amostras | runtime log |
| Exposure writes/exposure aceita | ≤ 1,25 | > 1,5 | > 2,0 | média / 15 min, mínimo 100 amostras | runtime log |
| Callables/sessão de Discovery | ≤ 4 | > 6 | > 10 | p95 / 60 min, mínimo 100 sessões | cliente/sintético |
| Push targets/notificação | ≤ 3 | > 5 | > 8 | p95 / 15 min, mínimo 100 notificações | runtime log |
| Storage upper bound/Comunidade | ≤ 256 MiB | > 512 MiB | > 1 GiB | máximo / 24 h | runtime log |

Os thresholds são estritamente “acima de”. Um valor igual ao limite de warning ou critical não muda de faixa.

## 1. Discovery — reads/card

Evento: `community_discovery_page_served`.

A métrica usada para orçamento é `operationalCostBudget.value`, derivada de:

```text
readUpperBoundProxy =
  projectionDocumentsFetched
  + membershipReads
  + cursorProjectionReads
  + fixedControlReadUpperBound

readsPerCard =
  readUpperBoundProxy / cardsReturned
```

`fixedControlReadUpperBound = 3` representa, sem I/O adicional:

- 1 read de elegibilidade social do usuário, feito em toda chamada protegida;
- até 2 reads do controle de ranking quando o cache de instância de 30 segundos está frio.

O valor continua sendo `operational_proxy_not_billed_reads`. Ele é deliberadamente conservador e não tenta reproduzir a fatura do Firestore.

Para alertas de produção, excluir páginas sem cards e preferir o fluxo normal de Discovery, por exemplo:

- `cardsReturned >= 6`;
- `requestedLimit >= 12`.

Isso evita que uma página intencionalmente pequena transforme custo fixo inevitável em falso alarme por card.

### Envelope atual

A página padrão pede 12 cards. O scan máximo continua limitado a:

```text
scanLimit = requestedLimit * 3 + 1
```

Para 12 cards, o teto de varredura da projeção é 37 documentos. Os lotes são incrementais, portanto atingir esse teto não é o comportamento esperado.

O caminho saudável tende a aproximadamente uma leitura de projeção + uma leitura de membership por card, acrescidas do custo fixo da chamada.

## 2. Exposure — writes/exposure aceita

Evento: `community_discovery_exposure_recorded`.

O cliente:

- registra apenas exposição qualificada;
- deduplica a mesma Comunidade por sessão autenticada;
- agrupa até 12 IDs;
- usa janela de 1,2 segundo;
- abre circuit breaker quando a telemetria falha.

O backend:

- revalida a projeção de cada ID submetido;
- grava um contador fragmentado para cada exposição aceita;
- consome uma quota backend por lote.

O proxy de writes é:

```text
operationalWritesProxy = acceptedExposures + 1 rate-limit write

writesPerAccepted =
  operationalWritesProxy / acceptedExposures
```

Exemplos:

| Lote aceito | Proxy de writes | writes/exposure |
| ---: | ---: | ---: |
| 12 | 13 | 1,08 |
| 4 | 5 | 1,25 |
| 1 | 2 | 2,00 |

Lotes com zero exposições aceitas não produzem razão por exposure; são avaliados separadamente por volume de chamadas/rejeição, não divididos artificialmente.

A retenção dos contadores agregados permanece em 35 dias.

## 3. Callables/sessão de Discovery

Esta métrica é um **orçamento arquitetural client/synthetic**, não um contador servidor-side.

Não existe hoje um identificador servidor-side de sessão apropriado para esse fim. O projeto não deve criar:

- documento de sessão;
- write por navegação;
- UID hash persistente;
- read adicional;
- identificador comportamental novo

somente para medir callables/sessão.

### Envelope da primeira abertura de Explorar

No caminho frio normal de uma sessão:

1. `getCommunityDiscoveryPage`;
2. `getCommunityTagCatalog` — cacheado com `shareReplay(1)`;
3. `getCommunityMembershipContext` — até 24 IDs por lote;
4. `recordCommunityDiscoveryExposure` — somente após exposição qualificada.

Target: **até 4 callables** na primeira abertura normal.

Uma paginação adicional normalmente acrescenta Discovery + contexto de membership + exposure. O catálogo não deve ser solicitado novamente na mesma vida do injector.

### Fonte do alerta

Enquanto não existir uma telemetria client-side central, privacy-safe e já necessária para outro propósito, este budget deve ser validado por:

- testes de fluxo;
- harness/synthetic de sessão;
- revisão de regressão quando novos callables entrarem no carregamento inicial.

Não usar Cloud Logging server-side para inventar “sessões” por UID.

## 4. Notification fan-out

Evento existente: `[sendNotification] push processado`.

Para notificações de Comunidades, `operationalCostBudget.value` recebe o número de targets **depois** de:

- filtro de dispositivos frescos;
- deduplicação;
- validação de ownership canônico do token;
- preferência global;
- mute da Comunidade;
- revalidação do ciclo de membership.

O registro de dispositivos já impõe hard cap de **10 dispositivos por usuário**.

O orçamento fica abaixo do hard cap:

- target ≤ 3;
- warning > 5;
- critical > 8.

Um critical significa que uma parcela relevante das notificações está chegando perto do fan-out máximo por usuário. Não significa, por si só, que o FCM esteja cobrando por mensagem.

O caminho revisado é recipient-oriented; não deve surgir broadcast para todos os membros da Comunidade sem orçamento e arquitetura específicos.

## 5. Storage/comunidade

Evento: `community_storage_cost_observed`, emitido somente quando uma foto comunitária foi realmente publicada.

Não existe hoje prefixo físico de Storage por `communityId`: o asset publicado é associado ao proprietário/post. Fazer inventário exato por Comunidade exigiria nova indexação ou consultas adicionais.

Por isso o orçamento usa, sem I/O extra:

```text
storageUpperBoundBytes =
  community.metrics.mediaCount
  * IMAGE_MAX_BYTES
```

`IMAGE_MAX_BYTES` vem da política canônica gerada de mídia. O Mural deixou de manter um limite de 10 MiB independente.

O evento também registra `publishedAssetBytes`, obtido da leitura de metadata que **já era obrigatória** para validar a imagem. Nenhuma operação de Storage foi adicionada para observabilidade.

O upper bound é deliberadamente conservador:

- target ≤ 256 MiB;
- warning > 512 MiB;
- critical > 1 GiB.

Warning/critical de storage significa **medir inventário físico e retenção antes de otimizar**, não bloquear upload automaticamente.

## Alertas operacionais

Os logs possuem o objeto `operationalCostBudget`, com:

- `metric`;
- `value`;
- `status`;
- `targetMax`;
- `warningAbove`;
- `criticalAbove`;
- `aggregation`;
- `windowMinutes`;
- `minimumSamples`;
- `measurementSource`;
- `semantics`.

Ao configurar Cloud Logging / Cloud Monitoring, criar uma distribution metric por dimensão e alertar usando a agregação e janela da política canônica.

### Resposta a alertas

**Warning**

- abrir investigação de custo;
- confirmar volume/amostra e regressão recente;
- comparar com billing real e latência;
- não alterar segurança/autorização;
- não otimizar por uma única amostra.

**Critical**

- tratar como incidente operacional de custo;
- identificar release ou crescimento de tráfego correlacionado;
- suspender novas mudanças que ampliem aquele caminho até entender a causa;
- validar billing real;
- aplicar mitigação somente se preservar os invariantes de segurança e produto.

### Gatilho para otimização

Uma otimização de custo deve ter motivação objetiva. Considerar o bloco elegível para otimização quando ocorrer pelo menos uma destas condições:

- critical com amostragem mínima em uma janela completa;
- warning em duas janelas consecutivas com amostragem mínima;
- tendência de billing incompatível com o orçamento financeiro do projeto;
- regressão de custo por unidade confirmada após uma release.

Sem uma dessas evidências, manter o desenho e coletar baseline.

## Alertas financeiros do projeto

O orçamento financeiro mensal **não deve ser inventado no código**. O valor em moeda depende do orçamento empresarial e deve ser definido pelo responsável pelo produto/billing.

Depois que esse valor for definido, configurar Cloud Billing Budget no projeto com alertas de gasto real em:

- 50%;
- 75%;
- 90%;
- 100%.

Adicionar também alerta de gasto **forecasted** antes de 100% quando o histórico já permitir previsão útil.

Budget alerts são alertas, não spend caps. Não automatizar desligamento de billing/serviços de produção como reação padrão: isso pode interromper autenticação, moderação, retenção, limpeza e acesso a dados.

## Referência de pricing — não é fonte canônica do runtime

Verificação de referência em 20/09/2026:

- Firebase Pricing: https://firebase.google.com/pricing
- Cloud Billing budgets: https://cloud.google.com/billing/docs/how-to/budgets

Na página oficial do Firebase, no momento da verificação:

- Firestore Standard possui faixa sem custo de 50 mil document reads/dia e 20 mil document writes/dia;
- Cloud Functions possui faixa sem custo de 2 milhões de invocações/mês; compute e rede têm cobrança própria;
- Firebase Cloud Messaging é listado como sem custo;
- buckets `*.firebasestorage.app` seguem Cloud Storage após a faixa gratuita aplicável.

Esses números não definem os thresholds técnicos acima e devem ser revistos antes de qualquer decisão financeira.

## Critério de fechamento

Este bloco está tecnicamente fechado quando:

- a política canônica possui testes;
- Discovery publica reads/card contra o budget;
- exposure publica writes/exposure contra o budget;
- push publica fan-out contra o budget;
- storage publica upper bound/comunidade sem I/O extra;
- callables/sessão está explicitamente classificado como client/synthetic;
- o checklist de pré-lançamento exige Cloud Billing Budget e alertas operacionais;
- Quality Gate permanece verde.

A criação efetiva dos recursos de Cloud Monitoring/Billing em um projeto real é configuração de infraestrutura/conta e não deve ocorrer implicitamente durante desenvolvimento local.
