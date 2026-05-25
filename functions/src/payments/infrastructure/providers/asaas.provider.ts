// functions/src/payments/infrastructure/providers/asaas.provider.ts
// -----------------------------------------------------------------------------
// ASAAS PAYMENT PROVIDER
// -----------------------------------------------------------------------------
//
// Placeholder seguro para a futura integração real com o Asaas.
//
// Importante:
// - este arquivo NÃO implementa checkout simulado;
// - este arquivo NÃO aceita webhook sem assinatura;
// - até que a API real e a validação criptográfica estejam implementadas,
//   qualquer uso falha de forma explícita.
//
// Próxima evolução:
// - credenciais armazenadas no Secret Manager;
// - criação real de cobrança/assinatura;
// - validação real de webhook;
// - mapeamento seguro de eventos pagos, cancelados, estornados e chargeback.

import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderPort,
  ProviderWebhookInput,
} from '../../domain/payment-provider.port';

import {
  VerifiedPaymentEvent,
} from '../../domain/billing.model';

export class AsaasPaymentProvider extends PaymentProviderPort {
  readonly providerId = 'asaas' as const;

  async createCheckoutSession(
    _input: CreateCheckoutInput
  ): Promise<CreateCheckoutResult> {
    throw new Error(
      'AsaasPaymentProvider ainda não foi configurado para pagamentos reais.'
    );
  }

  async cancelCheckoutSession(
    _providerSessionId: string
  ): Promise<void> {
    throw new Error(
      'AsaasPaymentProvider ainda não foi configurado para cancelamento real.'
    );
  }

  async verifyWebhook(
    _input: ProviderWebhookInput
  ): Promise<VerifiedPaymentEvent> {
    throw new Error(
      'Webhook Asaas rejeitado: validação segura ainda não implementada.'
    );
  }
}