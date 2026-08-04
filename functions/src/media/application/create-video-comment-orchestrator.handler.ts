import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  createVideoComment as createVideoCommentCore,
} from './manage-video-comment.handler';

/**
 * Mantém a callable e o nome histórico. A validação prévia de lifecycle foi
 * suprimida daqui porque ocorria antes da transação e criava uma janela TOCTOU.
 * O core agora revalida conta, audiência, bloqueios, publicação, moderação e
 * configuração de comentários dentro da mesma transação que grava o comentário.
 */
export const createVideoComment = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => createVideoCommentCore.run(request as any)
);
