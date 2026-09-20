// functions/src/community/community-callable-security.ts
// -----------------------------------------------------------------------------
// COMMUNITY CALLABLE SECURITY
// -----------------------------------------------------------------------------
// Alias de compatibilidade do contrato transversal de App Check. Comunidades
// mantêm os nomes públicos existentes, mas a decisão de segurança tem owner
// único em shared/security/callable-app-check.
// -----------------------------------------------------------------------------

import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
  shouldRequireCallableAppCheck,
  type CallableAppCheckEnvironment,
} from '../shared/security/callable-app-check';

export type CommunityAppCheckEnvironment = CallableAppCheckEnvironment;

export function shouldRequireCommunityAppCheck(
  environment: CommunityAppCheckEnvironment
): boolean {
  return shouldRequireCallableAppCheck(environment);
}

export const REQUIRE_COMMUNITY_APP_CHECK = REQUIRE_CALLABLE_APP_CHECK;

export function assertCommunityCallableAppCheck(appContext: unknown): void {
  assertCallableAppCheck(appContext);
}
