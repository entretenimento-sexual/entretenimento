# Pricing e ciclo de assinatura da plataforma

## Fonte canônica

A fonte financeira canônica dos planos `basic`, `premium` e `vip` é:

`functions/src/payments/application/billing-plan-catalog.service.ts`

Preço, moeda, intervalo, id do plano e versão do catálogo saem dessa fonte.

A UI de planos consulta `getPlatformPlans`; o checkout consulta novamente o
backend por `planKey`. O navegador nunca é autoridade financeira.

## Alteração de preço

Uma alteração no catálogo vale para **novos checkouts**. Ela não altera
retroativamente:

- pagamentos já liquidados;
- período já pago;
- snapshots financeiros de checkouts ainda dentro da janela válida.

Cada checkout armazena um `planSnapshot` imutável e uma expiração do preço.

Antes de criar a sessão, o cliente devolve ao backend o valor/moeda/intervalo e
versão de catálogo que acabou de exibir. Esses campos **não são autoridade
financeira**: servem apenas como pré-condição. O backend compara com o catálogo
vigente; se estiverem ausentes ou divergentes, recusa o checkout e exige recarga.
Assim uma mudança de preço entre a renderização e o clique nunca é cobrada
silenciosamente.

### Janela de preço do checkout

O preço fica congelado por até **30 minutos**. O provider recebe essa mesma expiração e não deve aceitar a intenção depois dela. Se o provider informar expiração anterior, prevalece a menor janela.

Depois da expiração, um checkout ainda não pago não pode ser liquidado com aquele
preço. O usuário deve criar uma nova sessão, que consultará o catálogo vigente.

Pagamento já processado continua idempotente mesmo depois da expiração do
checkout.

## Relação entre preço e período

### Nova assinatura

- cobra o preço vigente do catálogo no novo checkout;
- ativa após confirmação financeira;
- inicia um mês civil a partir do pagamento.

### Renovação do mesmo plano

- cobra o preço vigente do catálogo no novo checkout;
- não perde dias já pagos;
- estende um mês civil a partir do `endsAt` atual.

### Upgrade

- cobra o preço integral vigente do plano de destino;
- não existe proration nesta etapa;
- o plano superior entra em vigor após confirmação financeira;
- o tempo restante do plano anterior é preservado;
- o novo pagamento acrescenta um mês civil a partir do `endsAt` existente.

Essa regra é deliberadamente simples e auditável enquanto não há provider real
com suporte seguro a proration.

### Downgrade

Downgrade não é aplicado durante um período já pago.

Nesta etapa também não existe agendamento automático, porque ainda não há
cobrança recorrente real capaz de garantir a próxima renovação no plano menor.
A UI deve informar que a redução poderá ser contratada após o término do ciclo
atual; não deve sugerir que ela já foi programada.

## Invariantes

- preço exibido e preço de checkout vêm do mesmo catálogo backend;
- checkout revalida `planKey` e `planId`;
- valor confirmado precisa coincidir com o snapshot do checkout;
- alteração de catálogo nunca encurta vigência já paga;
- renovação e upgrade preservam `endsAt` como base de extensão;
- downgrade não reduz benefício vigente;
- proration permanece desabilitado até existir implementação financeira real;
- provider em cloud continua fail-closed enquanto webhook seguro não estiver
  implementado.

## Proteção de CI

`npm run billing:pricing-boundary:check` impede:

- voltar a hardcodar preço na tela de planos;
- separar a UI do catálogo backend;
- remover snapshot ou expiração de preço;
- remover a validação do settlement;
- alterar silenciosamente a semântica de período/proration.
