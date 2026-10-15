import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { isRestrictedVideoModerationStatus } from './video-publication-moderation.policy';
import { isCurrentVideoPublicationSource } from './video-publication-source-fence.policy';

export type OwnerVideoDoc = {
  id?: string;
  url?: string;
  path?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
  thumbnailUrl?: string;
  thumbnailPath?: string;
  status?: string;
  processedStoragePath?: string;
  playbackPath?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type VideoPublicationDoc = {
  isPublished?: boolean;
  moderationStatus?: string;
  sourceStoragePath?: string;
  rejectedSourceStoragePath?: string;
  publishedStoragePath?: string;
  publishedPosterStoragePath?: string;
};

const PUBLIC_VIDEO_CONTENT_TYPES = new Set(['video/mp4', 'video/webm']);

export function normalizeOptionalPositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return Math.trunc(numberValue);
}

export function assertPublishableVideo(ownerVideo: OwnerVideoDoc): void {
  const status = String(ownerVideo.status ?? '').trim().toLowerCase();
  const mimeType = String(ownerVideo.mimeType ?? '').trim().toLowerCase();
  const durationMs = normalizeOptionalPositiveInteger(ownerVideo.durationMs);

  if (status !== 'ready') {
    throw new HttpsError(
      'failed-precondition',
      'O vídeo precisa estar pronto antes da publicação.'
    );
  }

  if (!PUBLIC_VIDEO_CONTENT_TYPES.has(mimeType)) {
    throw new HttpsError(
      'failed-precondition',
      'Publique apenas vídeos MP4 ou WebM compatíveis.'
    );
  }

  if (!durationMs) {
    throw new HttpsError(
      'failed-precondition',
      'A duração do vídeo não foi confirmada.'
    );
  }
}

export function assertPublicationCanStart(
  publication: VideoPublicationDoc | null
): void {
  if (publication?.isPublished === true) {
    throw new HttpsError(
      'failed-precondition',
      'Este vídeo já está publicado.'
    );
  }

  if (isRestrictedVideoModerationStatus(publication?.moderationStatus)) {
    throw new HttpsError(
      'failed-precondition',
      'Este vídeo possui uma restrição de moderação ativa.'
    );
  }
}

export function assertSourceWasNotRejected(
  publication: VideoPublicationDoc | null,
  sourceStoragePath: string
): void {
  const rejectedSourceStoragePath = String(
    publication?.rejectedSourceStoragePath ?? ''
  ).trim();

  if (rejectedSourceStoragePath === sourceStoragePath) {
    throw new HttpsError(
      'failed-precondition',
      'Este arquivo foi rejeitado pela moderação. Exclua-o e envie uma nova versão.'
    );
  }
}

export interface CopiedVideoPublicationCommand {
  ownerUid: string;
  videoId: string;
  sourceVideoStoragePath: string;
  sourceProcessedStoragePath: string;
  publicationPatch: Record<string, unknown>;
  publicVideoPatch: Record<string, unknown>;
}

/** A shared production transaction, exercised against an isolated Firestore Emulator. */
export async function commitCopiedVideoPublicationIfCurrent(
  firestore: Firestore,
  command: CopiedVideoPublicationCommand
): Promise<VideoPublicationDoc | null> {
  const {
    ownerUid, videoId, sourceVideoStoragePath, sourceProcessedStoragePath,
    publicationPatch, publicVideoPatch,
  } = command;
  const ownerVideoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = firestore.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const publicVideoRef = firestore.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  return firestore.runTransaction(async (transaction) => {
    const [ownerSnap, publicationSnap] = await Promise.all([
      transaction.get(ownerVideoRef),
      transaction.get(publicationRef),
    ]);
    if (!ownerSnap.exists) {
      throw new HttpsError(
        'failed-precondition', 'O vídeo privado foi removido durante a publicação.'
      );
    }

    const currentOwnerVideo = ownerSnap.data() as OwnerVideoDoc;
    const currentPublication = publicationSnap.exists
      ? publicationSnap.data() as VideoPublicationDoc
      : null;
    assertPublishableVideo(currentOwnerVideo);
    assertPublicationCanStart(currentPublication);
    assertSourceWasNotRejected(currentPublication, sourceVideoStoragePath);
    if (!isCurrentVideoPublicationSource(
      ownerUid, videoId, currentOwnerVideo,
      sourceVideoStoragePath, sourceProcessedStoragePath
    )) {
      throw new HttpsError(
        'failed-precondition',
        'A origem ou a versão processada do vídeo mudou durante a publicação.'
      );
    }
    transaction.set(publicationRef, publicationPatch, { merge: true });
    transaction.set(publicVideoRef, publicVideoPatch, { merge: true });
    return currentPublication;
  });
}
