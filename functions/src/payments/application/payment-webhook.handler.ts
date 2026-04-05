//functions\src\payments\application\payment-webhook.handler.ts
import { onRequest } from 'firebase-functions/v2/https';

export const paymentWebhook = onRequest(async (_req, res) => {
  /**
   * Stub inicial:
   * - registrar evento
   * - validar assinatura do provedor
   * - localizar checkout_session
   * - aplicar status pago/falha/cancelado
   * - conceder entitlement
   */
  res.status(200).json({ ok: true, stub: true });
});