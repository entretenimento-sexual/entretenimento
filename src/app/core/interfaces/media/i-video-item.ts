// src/app/core/interfaces/media/i-video-item.ts
// -----------------------------------------------------------------------------
// Contratos do domínio de vídeos privados.
//
// Decisão de produto:
// - vídeo começa como biblioteca privada do usuário;
// - publicação pública fica bloqueada até existir moderação/derivados/custos;
// - uid continua sendo o identificador canônico do usuário;
// - este contrato evita expor Storage path bruto em telas públicas.
// -----------------------------------------------------------------------------

export type VideoProcessingStatus =
  | 'uploaded'
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
  readonly durationMs?: number | null;
  readonly thumbnailUrl?: string | null;
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
}
