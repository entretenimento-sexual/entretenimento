// functions/src/community/community-callable-security.ts
// -----------------------------------------------------------------------------
// COMMUNITY CALLABLE SECURITY
// -----------------------------------------------------------------------------
// Centraliza a exigência de App Check para callables de Comunidades.
//
// Política:
// - Emulator: App Check dispensado para preservar o desenvolvimento local;
// - qualquer runtime real (staging, produção ou desconhecido): App Check
//   obrigatório e fail closed.
//
// Os guards de disponibilidade de Comunidades permanecem uma fronteira
// independente. App Check autentica a origem do cliente, mas nunca habilita a
// feature por si só.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

export interface CommunityAppCheckEnvironment {
  functionsEmulator?: unknown;
}

export function shouldRequireCommunityAppCheck(
  environment: CommunityAppCheckEnvironment
): boolean {
  return environment.functionsEmulator !== 'true';
}

export const REQUIRE_COMMUNITY_APP_CHECK = shouldRequireCommunityAppCheck({
  functionsEmulator: process.env.FUNCTIONS_EMULATOR,
});

export function assertCommunityCallableAppCheck(appContext: unknown): void {
  if (!REQUIRE_COMMUNITY_APP_CHECK || appContext) {
    return;
  }

  throw new HttpsError(
    'unauthenticated',
    'Não foi possível verificar a origem desta solicitação.'
  );
}
