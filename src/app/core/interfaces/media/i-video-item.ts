// src/app/core/interfaces/media/i-video-item.ts
// -----------------------------------------------------------------------------
// Contratos do domínio de vídeos privados.
//
// Decisão de produto:
// - vídeo começa como biblioteca privada do usuário;
// - publicação cria cópia física e projeção pública separadas;
// - uid continua sendo o identificador canônico do usuário;
// - paths privados nunca entram em contratos de exibição pública.
// -----------------------------------------------------------------------------

export type VideoProcessingStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed';

export interface IVideoItem {
  readonly id: string;
  readonly ownerUid: string;
  readonly url: string;
  readonly path?: string | null;
  readonly fileName?: string | null;
  readonly mimeType?: string | null;
  readonly sizeBytes?: number | null;
  readonly sourceMimeType?: string | null;
  readonly sourceSizeBytes?: number | null;
  readonly durationMs?: number | null;
  readonly thumbnailUrl?: string | null;
  readonly thumbnailPath?: string | null;
  readonly playbackPath?: string | null;
  readonly processedStoragePath?: string | null;
  readonly processedOutputPrefix?: string | null;
  readonly processedMimeType?: string | null;
  readonly processedSizeBytes?: number | null;
  readonly processingJobId?: string | null;
  readonly processingStage?: string | null;
  readonly processingErrorCode?: string | null;
  readonly processingErrorMessage?: string | null;
  readonly processingCompletedAt?: number | null;
  readonly status: VideoProcessingStatus;
  readonly createdAt: number;
  readonly updatedAt?: number | null;
}

export interface IPrivateVideoMetadataInput {
  readonly id?: string | null;
  readonly url: string;
  readonly path: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationMs?: number | null;
  readonly thumbnailUrl?: string | null;
  readonly thumbnailPath?: string | null;
}
