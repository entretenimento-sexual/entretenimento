// functions/src/shared/runtime/functions-runtime.guard.ts
// -----------------------------------------------------------------------------
// FUNCTIONS RUNTIME GUARD
// -----------------------------------------------------------------------------
// Fonte única para detectar a execução real no Firebase Functions Emulator.
// Nunca confiar em parâmetros do cliente, NODE_ENV ou flags do frontend.
// -----------------------------------------------------------------------------

export function isFunctionsEmulatorRuntime(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

/**
 * Fail closed at the HTTP boundary of external payment providers.
 * Local payments must use EmulatorPaymentProvider, not a live API or sandbox.
 */
export function assertExternalPaymentEgressAllowed(): void {
  if (isFunctionsEmulatorRuntime()) {
    throw new Error('external_payment_egress_blocked_in_emulator');
  }
}
