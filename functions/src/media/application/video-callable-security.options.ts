import type { CallableOptions } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';

/**
 * Callables públicas de vídeo exigem App Check quando executadas no cloud.
 *
 * O Firebase Emulator Suite não emite um token App Check real; por isso a
 * exigência é desativada exclusivamente quando o runtime informa
 * FUNCTIONS_EMULATOR=true. Essa exceção não é controlada pelo cliente.
 */
export const VIDEO_PUBLIC_CALLABLE_OPTIONS: CallableOptions = {
  region: FUNCTIONS_REGION,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true',
};
