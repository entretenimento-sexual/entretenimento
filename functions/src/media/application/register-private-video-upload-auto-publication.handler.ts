import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  registerPrivateVideoUpload as registerPrivateVideoUploadCore,
} from './register-private-video-upload-orchestrator.handler';

export interface RegisterPrivateVideoUploadRequest {
  publishWhenReady?: unknown;
  [key: string]: unknown;
}

export function forceVideoAutoPublicationData(
  data: RegisterPrivateVideoUploadRequest | undefined
): RegisterPrivateVideoUploadRequest {
  return {
    ...(data ?? {}),
    publishWhenReady: true,
  };
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
    data: forceVideoAutoPublicationData(request.data),
  } as any)
);
