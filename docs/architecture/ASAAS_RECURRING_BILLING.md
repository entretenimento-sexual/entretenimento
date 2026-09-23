# Cobrança recorrente Asaas em produção

## Arquitetura

A assinatura da plataforma usa Checkout hospedado do Asaas com:

- `billingTypes: ['CREDIT_CARD']`;
- `chargeTypes: ['RECURRENT']`;
- ciclo `MONTHLY`;
- captura de cartão exclusivamente no domínio do Asaas;
- callback do navegador somente para navegação;
- Webhook autenticado como única entrada de eventos financeiros;
- inbox idempotente antes de qualquer processamento financeiro;
- settlement assíncrono por `payment.id`;
- reconciliação periódica de eventos fora de ordem e cancelamentos pendentes.

Nenhum PAN, CVV ou dado bruto de cartão deve entrar no Angular, Functions ou
Firestore.

## Segredos

Os segredos são gerenciados pelo Firebase Secret Manager:

- `ASAAS_API_KEY`
- `ASAAS_WEBHOOK_TOKEN`

O token de webhook é distinto da API key e deve ter entre 32 e 255 caracteres.

Exemplo operacional, sem gravar valores no repositório:

```bash
firebase functions:secrets:set ASAAS_API_KEY --project entretenimento-sexual
firebase functions:secrets:set ASAAS_WEBHOOK_TOKEN --project entretenimento-sexual
```

Configuração não secreta exigida no runtime:

- `ASAAS_ENVIRONMENT=production`
- `APP_BASE_URL=https://<host-publico-da-plataforma>`
- `ASAAS_RECURRING_ENABLED=true` somente depois da homologação final

A chave de produção precisa ter prefixo de produção. Sandbox e produção não
podem ser misturados.

## Webhook

O endpoint é a Cloud Function `paymentWebhook`.

No Asaas, configurar o mesmo valor de `ASAAS_WEBHOOK_TOKEN` como token de
autenticação do webhook e usar envio sequencial quando disponível.

Eventos relevantes:

### Checkout
- `CHECKOUT_PAID`
- `CHECKOUT_CANCELED`
- `CHECKOUT_EXPIRED`

### Assinatura
- `SUBSCRIPTION_CREATED`
- `SUBSCRIPTION_UPDATED`
- `SUBSCRIPTION_INACTIVATED`
- `SUBSCRIPTION_DELETED`

### Cobrança
- `PAYMENT_CONFIRMED`
- `PAYMENT_RECEIVED`
- `PAYMENT_OVERDUE`
- `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`
- `PAYMENT_REPROVED_BY_RISK_ANALYSIS`
- `PAYMENT_CREDIT_CARD_THREE_D_SECURE_CHALLENGE_FAILED`
- `PAYMENT_REFUNDED`
- `PAYMENT_RECEIVED_IN_CASH_UNDONE`
- `PAYMENT_CHARGEBACK_REQUESTED`
- `PAYMENT_CHARGEBACK_DISPUTE`

Eventos adicionais podem chegar sem quebrar o fluxo; eventos desconhecidos são
ignorados de forma segura.

## Idempotência e ordem

O webhook público apenas:

1. valida `asaas-access-token`;
2. sanitiza o envelope;
3. persiste por `event.id`;
4. responde rapidamente.

O trigger processa a inbox. Eventos que chegam antes do recurso relacionado
ficam em retry com backoff. O scheduler também recupera leases abandonados.

Uma mensalidade é liquidada por `payment.id`, portanto
`PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` da mesma cobrança nunca acrescentam
dois meses.

## Preço e vigência

Cada contrato recorrente guarda o snapshot do plano usado na contratação.

Mudanças futuras no catálogo:

- valem automaticamente para novos contratos;
- não reprecificam silenciosamente contratos recorrentes existentes;
- exigem migração explícita e auditável para alterar preço futuro de uma
  assinatura já existente.

Renovação paga estende um mês civil sem perder dias já pagos.

Upgrade cria um novo contrato recorrente. O contrato anterior só é
superseded/cancelado depois que a primeira cobrança do novo contrato é
confirmada.

Proration permanece desabilitado.

## Falha de cobrança

`OVERDUE`, recusa de captura, reprovação de risco e falha 3DS marcam problema
de pagamento, mas não retiram antecipadamente um período já pago.

Sem uma nova cobrança confirmada, o entitlement simplesmente expira no
`endsAt` já existente.

## Estorno e chargeback

Um estorno só revoga acesso imediatamente se a cobrança estornada ainda for a
fonte do entitlement atual. Estorno de uma cobrança antiga não apaga um período
posterior já quitado.

Chargeback também desabilita a renovação e agenda cancelamento no provider.

Estorno parcial não revoga automaticamente todo o período.

## Cancelamento pelo usuário

`cancelPlatformSubscriptionRenewal`:

- exige Auth + App Check;
- possui rate limit;
- persiste primeiro a intenção de cancelamento;
- tenta cancelar no Asaas;
- em falha externa deixa retry persistido;
- nunca retira o período já pago.

A UI diferencia:
- renovação ativa;
- cancelamento aguardando confirmação do provider;
- renovação cancelada.

## Exclusão da conta

Ao iniciar exclusão da conta, a plataforma também solicita o cancelamento da
recorrência. Indisponibilidade momentânea do Asaas não impede a exclusão:
o pedido fica persistido e o reconciliador tenta novamente.

## Homologação antes de produção

Antes de ativar `ASAAS_RECURRING_ENABLED=true` em produção:

1. validar Checkout recorrente no Sandbox;
2. validar primeiro pagamento e renovação simulada;
3. confirmar idempotência com replay de Webhook;
4. testar evento fora de ordem;
5. testar cancelamento do usuário;
6. testar checkout expirado;
7. testar cobrança recusada/overdue;
8. testar refund e chargeback;
9. confirmar que nenhuma coleção financeira é acessível pelo cliente;
10. confirmar que o webhook de produção usa o token correto;
11. só então habilitar credenciais e endpoint de produção.

Merge de código não prova deploy nem configuração do Asaas. A ativação só deve
ser considerada concluída após secrets, runtime, webhook, deploy e uma
homologação financeira controlada.
