//functions\src\payments\infrastructure\providers\asaas.provider.ts
import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderPort,
  PaymentWebhookResult,
} from '../../domain/payment-provider.port';

export class AsaasPaymentProvider extends PaymentProviderPort {
  async createCheckoutSession(
    input: CreateCheckoutInput
  ): Promise<CreateCheckoutResult> {
    /**
     * Stub inicial.
     * Próxima etapa:
     * - chamar API do Asaas no backend
     * - criar cobrança/assinatura
     * - devolver checkoutUrl real
     */
    return {
      provider: 'asaas',
      providerSessionId: `stub_asaas_${Date.now()}`,
      checkoutUrl: `${input.successUrl}?mockProvider=asaas&scope=${input.scope}`,
      expiresAt: null,
    };
  }

  async cancelCheckoutSession(_providerSessionId: string): Promise<void> {
    return;
  }

  async parseWebhook(
    _headers: Record<string, string>,
    _rawBody: string
  ): Promise<PaymentWebhookResult> {
    return {
      accepted: true,
    };
  }
}