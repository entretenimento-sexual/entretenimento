import type { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import type { IVideoPublicationConfig } from 'src/app/core/interfaces/media/i-video-publication-config';

export type VideoLifecycleState =
  | 'REGISTERED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'PUBLISHING'
  | 'PENDING_REVIEW'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'BLOCKED'
  | 'FAILED'
  | 'LEGACY_PRIVATE';

export type VideoLifecycleTone =
  | 'progress'
  | 'success'
  | 'warning'
  | 'error';

export interface VideoLifecyclePresentation {
  readonly state: VideoLifecycleState;
  readonly label: string;
  readonly message: string;
  readonly tone: VideoLifecycleTone;
  readonly terminal: boolean;
}

const PUBLIC_PLAYBACK_TYPES = new Set(['video/mp4', 'video/webm']);

const PRESENTATIONS: Readonly<
  Record<
    Exclude<VideoLifecycleState, 'FAILED' | 'REJECTED' | 'BLOCKED'>,
    VideoLifecyclePresentation
  >
> = {
  REGISTERED: {
    state: 'REGISTERED',
    label: 'Registrado',
    message: 'O upload foi registrado e aguarda entrada na fila de processamento.',
    tone: 'progress',
    terminal: false,
  },
  QUEUED: {
    state: 'QUEUED',
    label: 'Na fila',
    message: 'O vídeo está na fila de processamento.',
    tone: 'progress',
    terminal: false,
  },
  PROCESSING: {
    state: 'PROCESSING',
    label: 'Processando',
    message: 'A versão compatível do vídeo está sendo preparada.',
    tone: 'progress',
    terminal: false,
  },
  PUBLISHING: {
    state: 'PUBLISHING',
    label: 'Publicando',
    message: 'O processamento terminou e a publicação está sendo concluída.',
    tone: 'progress',
    terminal: false,
  },
  PENDING_REVIEW: {
    state: 'PENDING_REVIEW',
    label: 'Em análise',
    message: 'O vídeo foi processado e aguarda moderação antes de aparecer no perfil.',
    tone: 'warning',
    terminal: false,
  },
  PUBLISHED: {
    state: 'PUBLISHED',
    label: 'Publicado',
    message: 'O vídeo está disponível no perfil.',
    tone: 'success',
    terminal: true,
  },
  LEGACY_PRIVATE: {
    state: 'LEGACY_PRIVATE',
    label: 'Vídeo antigo',
    message: 'Este vídeo pertence ao fluxo antigo. Publique-o para concluir a migração ou exclua-o.',
    tone: 'warning',
    terminal: false,
  },
};

export function resolveVideoLifecyclePresentation(
  video: Pick<
    IVideoItem,
    | 'status'
    | 'processingErrorMessage'
    | 'processedStoragePath'
    | 'processedMimeType'
    | 'mimeType'
  >,
  publication: Pick<
    IVideoPublicationConfig,
    | 'isPublished'
    | 'publishWhenReady'
    | 'moderationStatus'
    | 'moderationReason'
  > | null | undefined
): VideoLifecyclePresentation {
  if (video.status === 'failed') {
    return {
      state: 'FAILED',
      label: 'Falha',
      message:
        cleanMessage(video.processingErrorMessage) ||
        'Não foi possível processar este arquivo. Exclua-o e envie uma nova versão.',
      tone: 'error',
      terminal: true,
    };
  }

  if (publication?.moderationStatus === 'REJECTED') {
    return {
      state: 'REJECTED',
      label: 'Rejeitado',
      message:
        cleanMessage(publication.moderationReason) ||
        'A moderação rejeitou esta versão. Exclua o arquivo e envie uma nova versão.',
      tone: 'error',
      terminal: true,
    };
  }

  if (
    publication?.moderationStatus === 'FLAGGED' ||
    publication?.moderationStatus === 'HIDDEN'
  ) {
    return {
      state: 'BLOCKED',
      label: publication.moderationStatus === 'FLAGGED' ? 'Sinalizado' : 'Oculto',
      message:
        cleanMessage(publication.moderationReason) ||
        'O vídeo está indisponível enquanto a revisão de segurança é concluída.',
      tone: 'error',
      terminal: false,
    };
  }

  if (
    publication?.isPublished === true &&
    publication.moderationStatus === 'APPROVED'
  ) {
    return PRESENTATIONS.PUBLISHED;
  }

  if (publication?.moderationStatus === 'PENDING_REVIEW') {
    return PRESENTATIONS.PENDING_REVIEW;
  }

  if (video.status === 'uploaded') {
    return PRESENTATIONS.REGISTERED;
  }

  if (video.status === 'queued') {
    return PRESENTATIONS.QUEUED;
  }

  if (video.status === 'processing') {
    return PRESENTATIONS.PROCESSING;
  }

  const hasProcessedPlayback = hasCompatibleProcessedPlayback(video);

  if (
    video.status === 'ready' &&
    hasProcessedPlayback &&
    publication?.isPublished !== true &&
    publication?.publishWhenReady === true
  ) {
    return PRESENTATIONS.PUBLISHING;
  }

  if (
    video.status === 'ready' &&
    hasProcessedPlayback &&
    publication !== null &&
    publication !== undefined &&
    publication.isPublished !== true &&
    publication.publishWhenReady !== true
  ) {
    return PRESENTATIONS.LEGACY_PRIVATE;
  }

  return PRESENTATIONS.REGISTERED;
}

function hasCompatibleProcessedPlayback(
  video: Pick<
    IVideoItem,
    'processedStoragePath' | 'processedMimeType' | 'mimeType'
  >
): boolean {
  const storagePath = String(video.processedStoragePath ?? '').trim();
  const mimeType = String(video.processedMimeType ?? video.mimeType ?? '')
    .trim()
    .toLowerCase();

  return !!storagePath && PUBLIC_PLAYBACK_TYPES.has(mimeType);
}

function cleanMessage(value: string | null | undefined): string {
  return String(value ?? '').trim().slice(0, 500);
}
