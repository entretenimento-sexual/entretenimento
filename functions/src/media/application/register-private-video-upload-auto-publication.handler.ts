import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  registerPrivateVideoUpload as registerPrivateVideoUploadCore,
} from './register-private-video-upload-orchestrator.handler';

interface RegisterPrivateVideoUploadRequest {
  publishWhenReady?: unknown;
  [key: string]: unknown;
}

/**
 * Fronteira pública do registro de vídeos.
 *
 * `publishWhenReady` deixou de ser uma escolha do cliente. O staging privado
 * permanece exclusivamente técnico e todo vídeo registrado deve continuar
 * para processamento e publicação automática quando o derivado ficar pronto.
 * A propriedade recebida de clientes antigos é deliberadamente sobrescrita.
 */
export const registerPrivateVideoUpload = onCall<
  RegisterPrivateVideoUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request) => registerPrivateVideoUploadCore.run({
    ...request,
    data: {
      ...(request.data ?? {}),
      publishWhenReady: true,
    },
  } as any)
);
