// functions/src/payments/infrastructure/providers/emulator-payment.provider.ts
// -----------------------------------------------------------------------------
// EMULATOR PAYMENT PROVIDER
// -----------------------------------------------------------------------------
//
// Provider exclusivamente local para desenvolvimento controlado.
//
// Segurança:
// - não se apresenta como gateway real;
// - não funciona em cloud;
// - não injeta sinal de provider na URL do navegador;
// - a confirmação financeira local depende do checkout persistido pelo backend
//   e do PaymentSettlementService protegido pelo Functions Emulator Runtime.
//
// Uso:
// - simular a navegação de checkout durante desenvolvimento;
// - validar UI, entitlement, auditoria e idempotência sem cobrança real.

import { randomUUID } from 'node:crypto';

import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderPort,
  ProviderWebhookInput,
} from '../../domain/payment-provider.port';

import { VerifiedPaymentEvent } from '../../domain/billing.model';

import {
  assertEmulatorPaymentRuntime,
} from '../../security/payment-runtime.guard';

export class EmulatorPaymentProvider extends PaymentProviderPort {
  readonly providerId = 'emulator' as const;

  async createCheckoutSession(
    input: CreateCheckoutInput
  ): Promise<CreateCheckoutResult> {
    assertEmulatorPaymentRuntime('create-emulator-checkout-session');

    /**
     * A URL recebida já contém somente:
     * - resultado visual;
     * - scope;
     * - checkoutSessionId.
     *
     * Não acrescentamos mockProvider ou providerSessionId ao navegador.
     */
    const checkoutUrl = new URL(input.successUrl).toString();

    return {
      provider: this.providerId,
      providerSessionId: `emulator_${randomUUID()}`,
      checkoutUrl,
      expiresAt: null,
    };
  }

  async cancelCheckoutSession(
    _providerSessionId: string
  ): Promise<void> {
    assertEmulatorPaymentRuntime('cancel-emulator-checkout-session');
  }

  async verifyWebhook(
    _input: ProviderWebhookInput
  ): Promise<VerifiedPaymentEvent> {
    assertEmulatorPaymentRuntime('verify-emulator-webhook');

    throw new Error(
      'Eventos simulados não são aceitos pelo webhook público. ' +
        'Use somente o retorno local controlado pelo Emulator.'
    );
  }
}