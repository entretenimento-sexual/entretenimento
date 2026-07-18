// functions/src/payments/security/payment-runtime.guard.ts
// -----------------------------------------------------------------------------
// PAYMENT RUNTIME GUARD
// -----------------------------------------------------------------------------
//
// Bloqueia comportamentos de simulação financeira fora do Emulator.
//
// Regra:
// - mock de checkout;
// - confirmação automática;
// - webhook de desenvolvimento;
//
// só podem operar quando a própria Functions Runtime declara execução em
// Emulator. Não confiar em NODE_ENV, query string, body ou frontend.
import { HttpsError } from 'firebase-functions/v2/https';

import {
  isFunctionsEmulatorRuntime,
} from '../../shared/runtime/functions-runtime.guard';

export { isFunctionsEmulatorRuntime };

export function assertEmulatorPaymentRuntime(operation: string): void {
  if (isFunctionsEmulatorRuntime()) {
    return;
  }

  throw new HttpsError(
    'failed-precondition',
    `A operação "${operation}" está disponível apenas no ambiente local de testes.`
  );
}

/**
 * Enquanto não houver gateway real implementado, operações financeiras
 * mutáveis permanecem indisponíveis na cloud.
 */
export function assertRealPaymentProviderConfigured(): never {
  throw new HttpsError(
    'failed-precondition',
    'Pagamento real ainda não está configurado com validação segura do provedor.'
  );
}

/**
 * Garante que o mock local não redirecione para origem externa inesperada.
 */
export function requireSafeEmulatorAppBaseUrl(rawValue: string | undefined): string {
  assertEmulatorPaymentRuntime('resolve-emulator-app-base-url');

  const raw = String(rawValue ?? 'http://localhost:4200').trim();
  const url = new URL(raw);

  const allowedHostnames = new Set(['localhost', '127.0.0.1']);

  if (!allowedHostnames.has(url.hostname)) {
    throw new HttpsError(
      'failed-precondition',
      'O checkout simulado só pode retornar para localhost.'
    );
  }

  return url.origin;
}
