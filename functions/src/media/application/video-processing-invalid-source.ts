export interface VideoProcessingFailureState {
  status?: string;
  processingStage?: string;
  processingErrorCode?: string;
}

export const INVALID_PROCESSING_SOURCE_CODE = 'INVALID_PROCESSING_SOURCE';

/**
 * Evita que o trigger de processamento regrave indefinidamente o mesmo erro.
 *
 * A função deve ser consultada somente depois de a origem atual ter sido
 * considerada inválida. Quando caminho, tipo, tamanho ou duração forem
 * corrigidos, a validação deixa de cair nesse ramo e o processamento pode ser
 * enfileirado normalmente, mesmo que o documento ainda carregue o erro antigo.
 */
export function hasPersistedInvalidProcessingSourceFailure(
  video: VideoProcessingFailureState
): boolean {
  const status = String(video.status ?? '').trim().toLowerCase();
  const stage = String(video.processingStage ?? '').trim().toLowerCase();
  const errorCode = String(video.processingErrorCode ?? '')
    .trim()
    .toUpperCase();

  return status === 'failed' &&
    stage === 'failed' &&
    errorCode === INVALID_PROCESSING_SOURCE_CODE;
}
