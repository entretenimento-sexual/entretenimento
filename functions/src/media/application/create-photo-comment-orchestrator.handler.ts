import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  createPhotoComment as createPhotoCommentCore,
} from './manage-photo-comment.handler';

/**
 * Nome público preservado. A autorização completa é executada pelo core dentro
 * da mesma transação que grava comentário e contadores.
 */
export const createPhotoComment = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => createPhotoCommentCore.run(request as any)
);
