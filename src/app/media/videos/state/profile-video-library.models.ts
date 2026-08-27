import type { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import type { IVideoPublicationConfig } from 'src/app/core/interfaces/media/i-video-publication-config';

/**
 * Metadados seguros para cache no NgRx.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - url/thumbnailUrl não entram no store porque são URLs assinadas efêmeras;
 * - paths de Storage também não entram no store para não ampliar a exposição
 *   de detalhes internos no DevTools/estado global.
 */
export interface IProfileVideoStoredVideo {
  readonly id: string;
  readonly ownerUid: string;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly sourceMimeType: string | null;
  readonly sourceSizeBytes: number | null;
  readonly durationMs: number | null;
  readonly processedMimeType: string | null;
  readonly processedSizeBytes: number | null;
  readonly processingStage: string | null;
  readonly processingErrorCode: string | null;
  readonly processingErrorMessage: string | null;
  readonly processingCompletedAt: number | null;
  readonly status: IVideoItem['status'];
  readonly createdAt: number;
  readonly updatedAt: number | null;
}

export interface IProfileVideoStoredItem {
  readonly video: IProfileVideoStoredVideo;
  readonly publication: IVideoPublicationConfig | null;
}

export interface IProfileVideoViewItem {
  readonly video: IVideoItem;
  readonly publication: IVideoPublicationConfig | null;
}

export function toProfileVideoStoredItems(
  videos: readonly IVideoItem[],
  publications: readonly IVideoPublicationConfig[]
): IProfileVideoStoredItem[] {
  const publicationByVideoId = new Map(
    publications.map((publication) => [publication.videoId, publication])
  );

  return videos.map((video) => ({
    video: {
      id: video.id,
      ownerUid: video.ownerUid,
      fileName: video.fileName ?? null,
      mimeType: video.mimeType ?? null,
      sizeBytes: video.sizeBytes ?? null,
      sourceMimeType: video.sourceMimeType ?? null,
      sourceSizeBytes: video.sourceSizeBytes ?? null,
      durationMs: video.durationMs ?? null,
      processedMimeType: video.processedMimeType ?? null,
      processedSizeBytes: video.processedSizeBytes ?? null,
      processingStage: video.processingStage ?? null,
      processingErrorCode: video.processingErrorCode ?? null,
      processingErrorMessage: video.processingErrorMessage ?? null,
      processingCompletedAt: video.processingCompletedAt ?? null,
      status: video.status,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt ?? null,
    },
    publication: publicationByVideoId.get(video.id) ?? null,
  }));
}

export function toEphemeralVideoItem(
  video: IProfileVideoStoredVideo
): IVideoItem {
  return {
    id: video.id,
    ownerUid: video.ownerUid,
    url: '',
    path: null,
    fileName: video.fileName,
    mimeType: video.mimeType,
    sizeBytes: video.sizeBytes,
    sourceMimeType: video.sourceMimeType,
    sourceSizeBytes: video.sourceSizeBytes,
    durationMs: video.durationMs,
    thumbnailUrl: null,
    thumbnailPath: null,
    playbackPath: null,
    processedStoragePath: null,
    processedOutputPrefix: null,
    processedMimeType: video.processedMimeType,
    processedSizeBytes: video.processedSizeBytes,
    processingJobId: null,
    processingStage: video.processingStage,
    processingErrorCode: video.processingErrorCode,
    processingErrorMessage: video.processingErrorMessage,
    processingCompletedAt: video.processingCompletedAt,
    status: video.status,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  };
}
