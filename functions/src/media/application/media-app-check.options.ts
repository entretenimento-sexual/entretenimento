import type { CallableOptions } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';

function isFunctionsEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true' ||
    process.env.FIREBASE_EMULATOR_HUB !== undefined;
}

/**
 * Em produção, toda emissão de URL exige App Check válido.
 * No emulador, a exigência é desativada porque não existe atestação real.
 */
export const MEDIA_ACCESS_CALLABLE_OPTIONS: CallableOptions = {
  region: FUNCTIONS_REGION,
  enforceAppCheck: !isFunctionsEmulator(),
};

/**
 * Registro de visualização usa token App Check de uso limitado para reduzir
 * replay automatizado. O cliente precisa solicitar limitedUseAppCheckTokens.
 */
export const MEDIA_VIEW_CALLABLE_OPTIONS: CallableOptions = {
  region: FUNCTIONS_REGION,
  enforceAppCheck: !isFunctionsEmulator(),
  consumeAppCheckToken: !isFunctionsEmulator(),
};
