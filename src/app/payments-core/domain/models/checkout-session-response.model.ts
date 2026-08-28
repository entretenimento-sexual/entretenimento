// src/app/payments-core/domain/models/checkout-session-response.model.ts
// -----------------------------------------------------------------------------
// CHECKOUT SESSION RESPONSE MODEL
// -----------------------------------------------------------------------------
//
// DTO sanitizado retornado pela callable createPlatformCheckoutSession.
//
// Este modelo não representa:
// - documento interno checkout_sessions;
// - provider executado pelo navegador;
// - webhook;
// - confirmação financeira.
//
// Responsabilidade da UI:
// - receber a URL criada pelo backend;
// - redirecionar o usuário ao fluxo correspondente;
// - posteriormente consultar a confirmação autorizada pelo backend.
import { BillingProvider } from './billing-plan.model';

export interface CreateCheckoutResult {
  provider: BillingProvider;
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt?: number | null;
  checkoutSessionId?: string | null;
}