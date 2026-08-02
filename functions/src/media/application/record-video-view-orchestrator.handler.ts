import { onCall } from 'firebase-functions/v2/https';

import { PROTECTED_CALLABLE_OPTIONS } from '../../config/protected-callable-options';
import {
  recordVideoViewCore,
  type RecordVideoViewRequest,
} from './record-video-view.handler';

/**
 * Mantém o nome público da callable e remove a execução indireta por `.run`.
 * Lifecycle, audiência, App Check e sessão são validados no núcleo tipado.
 */
export const recordVideoView = onCall<RecordVideoViewRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  recordVideoViewCore
);
