import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  createVideoComment as createVideoCommentCore,
} from './manage-video-comment.handler';

/**
 * Mantém o nome público e o ponto de orquestração existentes.
 * Lifecycle, idade, bloqueio bilateral e audiência são validados
 * transacionalmente pelo núcleo antes de criar o comentário.
 */
export const createVideoComment = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => createVideoCommentCore.run(request)
);
