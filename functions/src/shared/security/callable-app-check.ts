// functions/src/shared/security/callable-app-check.ts
// -----------------------------------------------------------------------------
// CALLABLE APP CHECK
// -----------------------------------------------------------------------------
// Política transversal: Emulator dispensa App Check; runtimes reais exigem.
// Domínios podem reexportar aliases sem duplicar a decisão de segurança.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

export interface CallableAppCheckEnvironment {
  functionsEmulator?: unknown;
}

export function shouldRequireCallableAppCheck(
  environment: CallableAppCheckEnvironment
): boolean {
  return environment.functionsEmulator !== 'true';
}

export const REQUIRE_CALLABLE_APP_CHECK = shouldRequireCallableAppCheck({
  functionsEmulator: process.env.FUNCTIONS_EMULATOR,
});

export function assertCallableAppCheck(appContext: unknown): void {
  if (!REQUIRE_CALLABLE_APP_CHECK || appContext) return;

  throw new HttpsError(
    'unauthenticated',
    'Não foi possível verificar a origem desta solicitação.'
  );
}
