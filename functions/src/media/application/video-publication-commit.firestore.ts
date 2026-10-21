import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { isRestrictedVideoModerationStatus } from './video-publication-moderation.policy';
import { isCurrentVideoPublicationSource } from './video-publication-source-fence.policy';
import { normalizePublishedVideoPlaybackPath } from './published-video-storage-mode.policy';
import {
  buildVideoOriginalCleanupJob,
  VIDEO_ORIGINAL_CLEANUP_COLLECTION,
  videoOriginalCleanupJobId,
} from './video-original-cleanup.policy';

export type OwnerVideoDoc = {
  id?: string;
  url?: string;
  path?: string;
  sourceGeneration?: string | null;
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
  assetStorageMode?: 'PROCESSED_CANONICAL' | 'COPIED_PUBLISHED';
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
  const identityRef = firestore.doc(
    `users/${ownerUid}/video_identity_guards/${videoId}`
  );
  const deletionRef = firestore.collection('media_video_deletion_jobs')
    .doc(`${ownerUid}_${videoId}`);
  // Allocate once, outside the retried Firestore callback.
  const preventiveReviewRef = firestore.collection('moderation_reports').doc();
  const pendingReview =
    publicationPatch['moderationStatus'] === 'PENDING_REVIEW';
  if (pendingReview !==
      (publicVideoPatch['moderationStatus'] === 'PENDING_REVIEW')) {
    throw new HttpsError('failed-precondition',
      'A publicacao e sua projecao divergem na moderacao preventiva.');
  }
  const publicationAssetVersion = publicationPatch['assetVersion'];
  const projectionAssetVersion = publicVideoPatch['assetVersion'];
  const hasVersion = publicationAssetVersion !== undefined ||
    projectionAssetVersion !== undefined;
  if (pendingReview && hasVersion &&
      (typeof publicationAssetVersion !== 'number' ||
       !Number.isSafeInteger(publicationAssetVersion) ||
       publicationAssetVersion <= 0 ||
       projectionAssetVersion !== publicationAssetVersion)) {
    throw new HttpsError('failed-precondition',
      'A revisao preventiva exige versoes publicadas consistentes.');
  }
  return firestore.runTransaction(async (transaction) => {
    const [ownerSnap, publicationSnap, identitySnap, deletionSnap] =
      await Promise.all([
        transaction.get(ownerVideoRef),
        transaction.get(publicationRef),
        transaction.get(identityRef),
        transaction.get(deletionRef),
      ]);
    // A deletion request atomically retires the identity and unpublishes.
    // Reading both guards in this same transaction prevents a late publish
    // from resurrecting a video while its processed asset is being removed.
    if (deletionSnap.exists || (identitySnap.exists && (
      identitySnap.get('state') !== 'REGISTERED' ||
      identitySnap.get('ownerUid') !== ownerUid ||
      identitySnap.get('videoId') !== videoId
    ))) {
      throw new HttpsError('failed-precondition',
        'A exclusao deste video ja foi solicitada.');
    }
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
    const mode = publicationPatch['assetStorageMode'];
    const publishedPath = normalizePublishedVideoPlaybackPath(
      ownerUid, videoId, publicationPatch['publishedStoragePath'], mode
    );
    if (!publishedPath || (mode === 'PROCESSED_CANONICAL' &&
        publishedPath !== sourceProcessedStoragePath)) {
      throw new HttpsError('failed-precondition',
        'O ativo publicado diverge da versão processada autorizada.');
    }
    // The cleanup intent is atomic with publication. A crash cannot leave
    // newly published originals untracked. Legacy sources without a GCS
    // generation remain untouched until explicitly reconciled.
    const originalCleanup = buildVideoOriginalCleanupJob({
      ownerUid, videoId, sourceStoragePath: sourceVideoStoragePath,
      sourceGeneration: currentOwnerVideo.sourceGeneration,
      processedStoragePath: sourceProcessedStoragePath,
      publishedStoragePath: publicationPatch['publishedStoragePath'],
      assetStorageMode: publicationPatch['assetStorageMode'],
      now: Date.now(),
    });
    if (originalCleanup) {
      const cleanupRef = firestore.collection(VIDEO_ORIGINAL_CLEANUP_COLLECTION)
        .doc(videoOriginalCleanupJobId(ownerUid, videoId));
      const pendingCleanup = await transaction.get(cleanupRef);
      if (!pendingCleanup.exists) transaction.create(cleanupRef, originalCleanup);
    }
    if (pendingReview) {
      transaction.create(preventiveReviewRef, {
        reporterUid: 'system',
        targetType: 'video',
        targetId: videoId,
        parentTargetId: videoId,
        targetOwnerUid: ownerUid,
        targetAuthorUid: ownerUid,
        reason: 'preventive_media_review',
        details: 'Publicacao de video aguardando revisao preventiva.',
        route: 'video',
        source: 'system',
        status: 'open',
        moderationAction: null,
        contentQuarantined: true,
        ...(hasVersion
          ? { quarantinedAssetVersion: publicationAssetVersion }
          : {}),
        evidencePreservationStatus: 'NOT_REQUIRED',
        legalReviewStatus: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const reviewLink = pendingReview
      ? { preventiveReviewReportId: preventiveReviewRef.id }
      : {};
    transaction.set(publicationRef, {
      ...publicationPatch, ...reviewLink,
    }, { merge: true });
    transaction.set(publicVideoRef, {
      ...publicVideoPatch, ...reviewLink,
    }, { merge: true });
    return currentPublication;
  });
}
