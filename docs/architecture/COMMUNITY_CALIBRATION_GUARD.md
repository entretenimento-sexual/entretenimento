# Community calibration guard — OBSERVE_ONLY

## Estado atual

Comunidades permanecem em `OBSERVE_ONLY`.

Este estágio existe para impedir calibração por intuição enquanto ainda estamos
coletando dados reais. Ele não muda pesos, preços, capacidades nem thresholds;
apenas impede que os sinais de readiness sejam interpretados como autorização
automática para recalibrar produto.

## Enquanto OBSERVE_ONLY estiver ativo

- ranking v3 continua shadow-only;
- `promote_v3` permanece bloqueado mesmo quando readiness técnica estiver verde;
- v2 e rollbacks continuam disponíveis;
- Business/Official pode calcular conversão, criação e custo realizado para
  observação, mas `canCalibrateCommercialOffer` permanece falso;
- Boost pode calcular custo realizado por entrega, mas
  `canCalibrateBoostCost` permanece falso;
- entitlement Business/Official continua sem preço/plano;
- capacidade técnica Official permanece apenas teto de segurança, não oferta;
- thresholds de custo atuais não devem ser alterados.

## Evidência mínima antes de discutir saída do estágio

A mudança para uma fase de calibração exige, no mínimo:

1. ranking v3 com pelo menos 7 ciclos observados de produção;
2. pelo menos 3 ciclos consecutivos aprovados;
3. origem `production_scheduled_runtime` no projeto real;
4. baseline operacional real qualificado por pelo menos 14 dias;
5. amostragem mínima das métricas canônicas;
6. custo financeiro realizado vindo de billing/finanças para decisões comerciais;
7. oferta, conversão e quantidade criada reais para Business/Official.

Cumprir esses requisitos **não altera automaticamente** score, capacidade,
preço ou thresholds. Apenas torna uma revisão de calibração elegível.

## Proteção de CI

`npm run community:calibration-freeze:check` falha se houver drift nos
parâmetros congelados durante `OBSERVE_ONLY`, incluindo:

- pesos e parâmetros do ranking candidato v3;
- thresholds e ciclos de aceitação v3;
- capacidade técnica Official;
- gates de baseline/custo real;
- thresholds operacionais de custo;
- separação entre entitlement Business/Official e preço/plano.

Para alterar qualquer um desses parâmetros, primeiro deve existir evidência real
suficiente e uma decisão explícita de saída do estágio de observação.
