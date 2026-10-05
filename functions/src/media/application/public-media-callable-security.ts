// functions/src/media/application/public-media-callable-security.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA CALLABLE APP CHECK
// -----------------------------------------------------------------------------
// Alias de domínio sobre a autoridade transversal. Todo runtime real exige
// App Check; somente o Functions Emulator é dispensado. Staging não possui
// bypass backend: precisa de configuração App Check real antes de uso remoto.
// -----------------------------------------------------------------------------

import {
  assertCallableAppCheck,
  shouldRequireCallableAppCheck,
} from '../../shared/security/callable-app-check';

export interface PublicMediaAppCheckEnvironment {
  functionsEmulator?: unknown;
  gcloudProject?: unknown;
  gcpProject?: unknown;
  firebaseConfig?: unknown;
}

export function shouldRequirePublicMediaAppCheck(
  environment: PublicMediaAppCheckEnvironment
): boolean {
  return shouldRequireCallableAppCheck({
    functionsEmulator: environment.functionsEmulator,
  });
}

export const REQUIRE_PUBLIC_MEDIA_APP_CHECK =
  shouldRequirePublicMediaAppCheck({
    functionsEmulator: process.env.FUNCTIONS_EMULATOR,
  });

export function assertPublicMediaCallableAppCheck(
  appContext: unknown
): void {
  assertCallableAppCheck(appContext);
}
