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

Downgrade nunca reduz um período já pago.

Quando a capability de atualização da recorrência está habilitada, a redução
pode ser agendada para `endsAt`:

- o entitlement e o papel atuais permanecem intactos até o fim do ciclo;
- o backend persiste um snapshot do plano menor e sua data efetiva;
- o valor da recorrência futura é atualizado no provedor;
- uma cobrança do valor menor confirmada antes de `endsAt` fica retida para
  settlement até a virada do ciclo;
- na virada, o novo pagamento inicia o período seguinte no plano menor;
- o usuário pode cancelar o agendamento, restaurando o valor futuro do plano
  atual sem cancelar a renovação.

Fora do Emulator, a capability é fail-closed e depende de
`ASAAS_SUBSCRIPTION_UPDATE_ENABLED=true`. Sem essa capacidade operacional a
UI continua informando que a redução só poderá ocorrer após o ciclo atual.

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


## Recorrência real em produção

Quando uma contratação cria uma assinatura recorrente no provedor, o
`planSnapshot` do checkout passa a ser também o preço contratual da recorrência.

Uma alteração posterior em `billing-plan-catalog.service.ts`:

- vale imediatamente para novos checkouts;
- vale para upgrades ou novas contratações que o usuário confirmar;
- **não altera silenciosamente o valor de uma recorrência já ativa**;
- não altera períodos já pagos.

A recorrência mantém `amountCents`, moeda, ciclo e `catalogVersion` do contrato
até uma mudança explícita. Repricing de contratos existentes exige fluxo próprio
de migração/consentimento e não acontece por simples alteração de variável.

### Renovação automática

- o Asaas gera a nova cobrança mensal;
- `PAYMENT_CONFIRMED` é suficiente para liquidar o novo período;
- `payment.id` é a chave de idempotência financeira;
- um `PAYMENT_RECEIVED` posterior do mesmo pagamento não acrescenta outro mês;
- o novo período continua sendo estendido a partir do `endsAt` já pago;
- falha de captura ou atraso não retira antecipadamente o período já quitado.

### Upgrade com recorrência existente

O upgrade abre um novo Checkout com o preço atual do plano de destino.

Somente depois do primeiro pagamento confirmado:

1. o novo contrato se torna o contrato recorrente atual;
2. o entitlement sobe para o novo plano;
3. todo tempo já pago é preservado;
4. a recorrência anterior é marcada como substituída;
5. o backend cancela a recorrência anterior no provedor;
6. falha nesse cancelamento entra em retry operacional até convergir.

Isso evita cancelar o plano antigo antes de saber que o upgrade foi realmente
pago.

### Cancelamento pelo usuário

Cancelar renovação:

- impede novas cobranças;
- não revoga o entitlement já pago;
- mantém acesso até `endsAt`;
- persiste a intenção antes da chamada externa;
- se o provedor estiver indisponível, o cancelamento externo entra em retry.

### Exclusão de conta

O expurgo definitivo não pode concluir enquanto houver uma recorrência externa
capaz de gerar cobrança. A retenção financeira deve cancelar a assinatura no
provedor antes de pseudonimizar o contrato e liberar a exclusão do documento
privado do usuário.

### Webhook

O endpoint público apenas:

1. valida `asaas-access-token`;
2. normaliza um envelope mínimo;
3. grava o evento idempotentemente;
4. responde HTTP 200.

O processamento ocorre de forma assíncrona. O payload bruto do provedor não é
armazenado, evitando persistir dados de cartão que possam existir em eventos de
cobrança.
