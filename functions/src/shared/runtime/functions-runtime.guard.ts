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

/**
 * Any Google Video Transcoder network request must be blocked in Functions Emulator.
 * The local MP4/WebM processor is a separate, emulator-only path.
 */
export function assertExternalVideoEgressAllowed(): void {
  if (isFunctionsEmulatorRuntime()) {
    throw new Error('external_video_egress_blocked_in_emulator');
  }
}

/**
 * The Admin SDK enqueues Cloud Tasks remotely if CLOUD_TASKS_EMULATOR_HOST is
 * missing. Require an explicit loopback endpoint at the enqueue boundary.
 */
export function assertCloudTasksEmulatorConfigured(
  env: Record<string, string | undefined> = process.env
): void {
  if (env['FUNCTIONS_EMULATOR'] !== 'true') return;

  const endpoint = String(env['CLOUD_TASKS_EMULATOR_HOST'] ?? '').trim();
  const match = /^(?:localhost|127\.0\.0\.1|\[::1\]):([0-9]{1,5})$/.exec(endpoint);
  const port = match ? Number(match[1]) : 0;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      '[functions:emulator] CLOUD_TASKS_EMULATOR_HOST precisa apontar para localhost.'
    );
  }
}

/**
 * Functions Emulator must never instantiate Admin SDK clients with missing
 * emulator endpoints: that would send real-project operations to Cloud APIs.
 */
export function assertFirebaseEmulatorDependenciesConfigured(
  env: Record<string, string | undefined> = process.env
): void {
  if (env['FUNCTIONS_EMULATOR'] !== 'true') return;

  const required = [
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ] as const;

  for (const name of required) {
    const endpoint = String(env[name] ?? '').trim();
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\]):[0-9]{1,5}$/.test(endpoint)) {
      throw new Error('[functions:emulator] ' + name + ' precisa apontar para localhost.');
    }
    const port = Number(endpoint.slice(endpoint.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error('[functions:emulator] Porta inválida em ' + name + '.');
    }
  }
}
