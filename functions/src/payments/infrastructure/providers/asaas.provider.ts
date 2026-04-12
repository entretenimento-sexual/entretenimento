//functions\src\payments\infrastructure\providers\asaas.provider.ts
// Não esqueça os comentários explicativos e ferramentas de debug
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
     *
     * Nesta fase:
     * - preservamos successUrl e cancelUrl já montadas pelo backend
     * - não concatenamos query string manualmente
     * - simulamos uma URL de checkout do provider apontando para o retorno de sucesso
     *
     * Próxima etapa:
     * - chamar API real do Asaas
     * - criar cobrança/assinatura
     * - devolver checkoutUrl real hospedada pelo provider
     */
    const successUrl = new URL(input.successUrl);

    // Garante mockProvider sem quebrar query string existente.
    if (!successUrl.searchParams.has('mockProvider')) {
      successUrl.searchParams.set('mockProvider', 'asaas');
    }

    if (!successUrl.searchParams.has('scope')) {
      successUrl.searchParams.set('scope', input.scope);
    }

    return {
      provider: 'asaas',
      providerSessionId: `stub_asaas_${Date.now()}`,
      checkoutUrl: successUrl.toString(),
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