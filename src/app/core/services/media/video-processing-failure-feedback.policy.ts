/**
 * Feedback seguro para falhas ASSÍNCRONAS de processamento, vindas do documento
 * privado do vídeo. Não exibir processingErrorMessage / mensagens do provedor.
 * Para exceções de operações, manter MediaApplicationErrorService.
 */
export interface VideoProcessingFailureFeedback {
  readonly title: string;
  readonly message: string;
  readonly recovery: string;
  /** Indica uma falha que pode desaparecer; não habilita retry automático. */
  readonly retryable: boolean;
}

const INVALID_VIDEO: VideoProcessingFailureFeedback = Object.freeze({
  title: 'Arquivo de vídeo inválido',
  message: 'Não foi possível validar o conteúdo do vídeo enviado.',
  recovery: 'Selecione outra cópia do arquivo e envie novamente.',
  retryable: false,
});

const SOURCE_CHANGED: VideoProcessingFailureFeedback = Object.freeze({
  title: 'Arquivo de origem alterado',
  message: 'O arquivo armazenado já não corresponde à versão recebida.',
  recovery: 'Exclua este item e envie novamente o vídeo original.',
  retryable: false,
});

const SERVICE_FAILURE: VideoProcessingFailureFeedback = Object.freeze({
  title: 'Preparação não concluída',
  message: 'Não foi possível finalizar a versão reproduzível do vídeo.',
  recovery: 'O vídeo não foi publicado. Tente enviar outra cópia mais tarde.',
  retryable: true,
});

const SUBMISSION_UNCONFIRMED: VideoProcessingFailureFeedback = Object.freeze({
  title: 'Confirmação do processamento pendente',
  message: 'Ainda não foi possível confirmar se a preparação do vídeo começou.',
  recovery: 'Não reenvie o vídeo agora. Aguarde a verificação do processamento pela plataforma.',
  retryable: false,
});

const PROBE_TEMPORARY: VideoProcessingFailureFeedback = Object.freeze({
  title: 'Verificação temporariamente indisponível',
  message: 'A análise técnica do vídeo não pôde ser concluída.',
  recovery: 'O vídeo não foi publicado. Aguarde a recuperação do serviço antes de reenviar.',
  retryable: true,
});

const EDIT_REJECTED: VideoProcessingFailureFeedback = Object.freeze({
  title: 'Edição não aplicada',
  message: 'Os ajustes selecionados não são compatíveis com este vídeo.',
  recovery: 'Selecione o original novamente e revise cortes, duração e enquadramento.',
  retryable: false,
});

const MISSING_SOURCE: VideoProcessingFailureFeedback = Object.freeze({
  title: 'Vídeo original indisponível',
  message: 'O arquivo necessário para finalizar o processamento não foi encontrado.',
  recovery: 'Se o vídeo ainda estiver na sua biblioteca, exclua o item e envie-o novamente.',
  retryable: false,
});

const MEDIA_PROBE_FAILURES: Readonly<Record<string, VideoProcessingFailureFeedback>> =
  Object.freeze({
    INVALID_PROCESSING_SOURCE: INVALID_VIDEO,
    VIDEO_PROBE_INVALID_MEDIA: INVALID_VIDEO,
    VIDEO_PROBE_NO_VIDEO_STREAM: INVALID_VIDEO,
    VIDEO_PROBE_INVALID_DIMENSIONS: INVALID_VIDEO,
    VIDEO_PROBE_INVALID_DURATION: INVALID_VIDEO,
    VIDEO_PROBE_UNSUPPORTED_VIDEO: INVALID_VIDEO,
    VIDEO_PROBE_UNSUPPORTED_ROTATION: INVALID_VIDEO,
    INVALID_VIDEO_EDIT_RECIPE: EDIT_REJECTED,
    SOURCE_CHANGED,
    VIDEO_PROBE_SOURCE_CHANGED: SOURCE_CHANGED,
    VIDEO_PROBE_GENERATION_MISMATCH: SOURCE_CHANGED,
    VIDEO_PROBE_SOURCE_GENERATION_MISMATCH: SOURCE_CHANGED,
    PRIVATE_VIDEO_DELETED: MISSING_SOURCE,
    VIDEO_DELETED: MISSING_SOURCE,
    VIDEO_PROBE_SOURCE_NOT_FOUND: MISSING_SOURCE,
    VIDEO_PROBE_TIMEOUT: PROBE_TEMPORARY,
    VIDEO_PROBE_UNAVAILABLE: PROBE_TEMPORARY,
    VIDEO_PROBE_WORKER_UNAVAILABLE: PROBE_TEMPORARY,
    VIDEO_PROBE_INVALID_RESPONSE: PROBE_TEMPORARY,
    VIDEO_PROBE_SOURCE_GENERATION_UNAVAILABLE: SOURCE_CHANGED,
    TRANSCODER_SUBMISSION_UNCONFIRMED: SUBMISSION_UNCONFIRMED,
    TRANSCODER_JOB_FAILED: SERVICE_FAILURE,
    MAX_ATTEMPTS_EXCEEDED: SERVICE_FAILURE,
  });

/** A presença de áudio não é exigida: vídeos silenciosos são válidos. */
export function resolveVideoProcessingFailureFeedback(
  processingErrorCode: unknown
): VideoProcessingFailureFeedback {
  if (typeof processingErrorCode !== 'string') return SERVICE_FAILURE;
  const code = processingErrorCode.trim().toUpperCase();
  // Nunca refletir códigos arbitrários, mensagens do usuário ou payloads técnicos.
  if (!/^[A-Z0-9_-]{1,100}$/.test(code)) return SERVICE_FAILURE;
  return MEDIA_PROBE_FAILURES[code] ?? SERVICE_FAILURE;
}
