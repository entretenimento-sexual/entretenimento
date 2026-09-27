# Product calibration guard — OBSERVE_ONLY

## Estado atual

A plataforma permanece em `OBSERVE_ONLY` para parâmetros de produto que podem
afetar distribuição, custo ou monetização.

A fonte canônica do estágio é
`functions/src/shared/calibration/product-calibration-stage.policy.ts`.
Comunidades consome essa fonte por compatibilidade de domínio.

O objetivo é impedir calibração por intuição. Dados reais podem tornar uma
dimensão **elegível para revisão**, mas nenhum baseline, workflow ou contador
altera automaticamente score, limite, fan-out, cadência ou preço.

## Dimensões protegidas

### Hot score / ranking

O candidato v3 continua shadow-only. Pesos, half-lives, confiança, thresholds de
aceitação e cutover permanecem congelados enquanto não houver ciclos reais de
produção suficientes e baseline operacional qualificado.

### Limites comerciais

Capacidade de membros e quantidade de Comunidades por plano/grant continuam
congeladas. Além de oferta, conversão, criação e custo financeiro realizado, a
revisão exige utilização real agregada de produção para:

- capacidade de membros;
- quantidade de Comunidades concedida.

Proxies operacionais não são custo em moeda.

### Quantidade de derivados

No código atual, esta dimensão é medida como **fan-out de writes derivados por
evento-fonte**. Os pipelines principais emitem observações reais no Cloud
Logging sem criar persistência adicional só para telemetria.

O baseline canônico exige a métrica:

`community.projection.derived_writes_per_source_event`

A observação permite discutir redução/aumento de projeções com evidência, mas não
define um número-alvo por intuição.

### Frequência de notificações

A janela atual de agrupamento permanece congelada. Pushes sociais do Mural
registram quantas atividades reais foram agrupadas por entrega através de:

`community.notification.grouped_activities_per_push`

A cadência só deve ser revista após janela real suficiente, junto com fan-out de
push e impacto operacional.

### Preços

Os preços canônicos permanecem em
`functions/src/payments/application/billing-plan-catalog.service.ts`.

A policy
`scripts/quality/platform-pricing-calibration.mjs`
é executada na camada operacional/quality e aceita apenas:

- conversões pagas reais;
- renovações liquidadas reais;
- cancelamentos observados;
- receita realizada;
- custo financeiro atribuído;
- fonte financeira canônica;
- baseline operacional de produção qualificado.

Ela calcula diagnóstico para revisão, nunca preço recomendado e nunca altera o
catálogo automaticamente.

## Evidência mínima transversal

Antes de discutir saída do estágio:

1. janela de produção de pelo menos 14 dias;
2. métricas runtime com pelo menos 100 amostras e 7 dias observados quando
   aplicável;
3. ranking v3 com pelo menos 7 ciclos observados e 3 ciclos consecutivos
   aprovados;
4. origem real de produção;
5. custo financeiro realizado quando a decisão for comercial;
6. utilização comercial real para limites;
7. fan-out derivado real para quantidade de projeções;
8. agrupamento real de atividades para frequência de notificações;
9. conversão paga e renovação real para pricing.

Cumprir os requisitos não autoriza mudança automática. Apenas habilita revisão
humana explícita e versionada.

## Readiness transversal por dimensão

A consolidação canônica de prontidão para revisão vive em:

`functions/src/shared/calibration/product-calibration-readiness.policy.ts`

Ela avalia separadamente:

- `hot_score`;
- `commercial_limits`;
- `derived_fanout`;
- `notification_frequency`;
- `pricing`.

Cada dimensão expõe apenas `reviewEligible`, `canChange` e as evidências
faltantes. As fontes aceitas são restritas às origens reais correspondentes
(runtime agendado de produção, agregados de estado de produção, Cloud Logging,
Cloud Billing/finanças e settlements financeiros).

Durante `OBSERVE_ONLY`, uma dimensão pode se tornar elegível para revisão, mas
`canChange` continua obrigatoriamente `false`. A policy não calcula valor
recomendado e não escreve configuração.

## Proteção de CI

`npm run community:calibration-freeze:check` falha durante
`OBSERVE_ONLY` se houver drift em:

- parâmetros do ranking/hot score;
- thresholds de aceitação;
- limites comerciais;
- janela de agrupamento de notificações;
- preços do catálogo;
- gates de baseline e custo real;
- wiring das observações de fan-out derivado e agrupamento de notificações;
- separação entre entitlement e preço/plano.

O baseline de produção continua sendo capturado fora do repositório e não deve
ser commitado como dado operacional.
