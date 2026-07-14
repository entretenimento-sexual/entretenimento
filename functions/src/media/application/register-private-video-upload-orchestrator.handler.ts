import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { ensurePrivateVideoProcessingQueued } from './queue-video-processing.handler';
import {
  registerPrivateVideoUpload as registerPrivateVideoUploadCore,
} from './register-private-video-upload.handler';

interface RegisteredPrivateVideoResponse {
  ownerUid: string;
  videoId: string;
  [key: string]: unknown;
}

/**
 * Registra o upload e só responde depois que a fila idempotente foi persistida.
 * O trigger Firestore continua como mecanismo de reconciliação e recuperação.
 */
export const registerPrivateVideoUpload = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const response = await registerPrivateVideoUploadCore.run(request as any) as
      RegisteredPrivateVideoResponse;

    await ensurePrivateVideoProcessingQueued(
      response.ownerUid,
      response.videoId
    );

    return response;
  }
);
