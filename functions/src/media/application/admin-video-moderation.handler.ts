import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import { deletePublishedVideoAssetOrQueue } from './published-video-asset.service';
import {
  normalizeOwnedPublishedVideoPath,
  normalizeOwnedPublishedVideoPosterPath,
} from './video-storage-path';

type AdminVideoModerationDecision = 'APPROVE' | 'REJECT';

interface ListVideoModerationQueueRequest {
  limit?: number;
}

interface AdminVideoModerationItem {
  ownerUid: string;
  videoId: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  publishedAt: number;
  moderationStatus: 'PENDING_REVIEW';
  url: string;
  posterUrl: string | null;
  accessExpiresAt: number;
}

interface ListVideoModerationQueueResponse {
  items: AdminVideoModerationItem[];
  skippedItems: number;
}

interface ReviewVideoModerationRequest {
  ownerUid?: string;
  videoId?: string;
  decision?: AdminVideoModerationDecision;
  reason?: string | null;
}

interface ReviewVideoModerationResponse {
  ownerUid: string;
  videoId: string;
  moderationStatus: 'APPROVED' | 'REJECTED';
  cleanupPending: boolean;
}

interface PublicVideoDocument {
  ownerUid?: string;
  id?: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number | null;
  publishedAt?: unknown;
  visibility?: string;
  moderationStatus?: string;
}

interface VideoPublicationDocument {
  ownerUid?: string;
  videoId?: string;
  isPublished?: boolean;
  visibility?: string;
  moderationStatus?: string;
  sourceStoragePath?: string;
  publishedStoragePath?: string;
  publishedPosterStoragePath?: string;
}

const DEFAULT_QUEUE_LIMIT = 40;
const MAX_QUEUE_LIMIT = 80;
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    containsControlCharacter(normalized)
  ) {
    return '';
  }

  return normalized;
}

function cleanReason(value: unknown): string {
  return String(value ?? '').trim().slice(0, 900);
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return Math.trunc(numberValue);
}

function toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  const timestamp = value as { toMillis?: () => number } | null | undefined;

  if (typeof timestamp?.toMillis === 'function') {
    return timestamp.toMillis();
  }

  return 0;
}

function normalizeLimit(value: unknown): number {
  const numberValue = Number(value ?? DEFAULT_QUEUE_LIMIT);

  if (!Number.isFinite(numberValue)) {
    return DEFAULT_QUEUE_LIMIT;
  }

  return Math.max(1, Math.min(MAX_QUEUE_LIMIT, Math.trunc(numberValue)));
}

function assertAdmin(requestAuth: {
  uid: string;
  token: Record<string, unknown>;
} | null | undefined): string {
  const adminUid = cleanId(requestAuth?.uid);
  const token = requestAuth?.token ?? {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  const allowed = token['admin'] === true ||
    token['role'] === 'admin' ||
    roles.includes('admin');

  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores podem moderar vídeos.'
    );
  }

  return adminUid;
}

function normalizeDecision(value: unknown): AdminVideoModerationDecision | null {
  const normalized = String(value ?? '').trim().toUpperCase();

  return normalized === 'APPROVE' || normalized === 'REJECT'
    ? normalized
    : null;
}

async function createTemporaryReadUrl(
  storagePath: string,
  expiresAt: number
): Promise<string> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const bucketName = storage.bucket().name;
    return (
      `http://127.0.0.1:9199/v0/b/${encodeURIComponent(bucketName)}/o/` +
      `${encodeURIComponent(storagePath)}?alt=media`
    );
  }

  const [signedUrl] = await storage
    .bucket()
    .file(storagePath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });

  return signedUrl;
}

async function buildQueueItem(
  ownerUid: string,
  videoId: string,
  publicVideo: PublicVideoDocument,
  expiresAt: number
): Promise<AdminVideoModerationItem | null> {
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const publicationSnap = await publicationRef.get();

  if (!publicationSnap.exists) {
    return null;
  }

  const publication = publicationSnap.data() as VideoPublicationDocument;

  if (
    publication.isPublished !== true ||
    publication.moderationStatus !== 'PENDING_REVIEW'
  ) {
    return null;
  }

  const videoStoragePath = normalizeOwnedPublishedVideoPath(
    ownerUid,
    videoId,
    publication.publishedStoragePath
  );

  if (!videoStoragePath) {
    return null;
  }

  const videoFile = storage.bucket().file(videoStoragePath);
  const [videoExists] = await videoFile.exists();

  if (!videoExists) {
    return null;
  }

  const posterStoragePath = normalizeOwnedPublishedVideoPosterPath(
    ownerUid,
    videoId,
    publication.publishedPosterStoragePath
  );
  let posterUrl: string | null = null;

  if (posterStoragePath) {
    const posterFile = storage.bucket().file(posterStoragePath);
    const [posterExists] = await posterFile.exists();

    if (posterExists) {
      posterUrl = await createTemporaryReadUrl(posterStoragePath, expiresAt);
    }
  }

  return {
    ownerUid,
    videoId,
    title: String(publicVideo.title ?? 'Vídeo do perfil').trim().slice(0, 160),
    mimeType: String(publicVideo.mimeType ?? '').trim().toLowerCase(),
    sizeBytes: normalizePositiveInteger(publicVideo.sizeBytes) ?? 0,
    durationMs: normalizePositiveInteger(publicVideo.durationMs),
    publishedAt: toMillis(publicVideo.publishedAt),
    moderationStatus: 'PENDING_REVIEW',
    url: await createTemporaryReadUrl(videoStoragePath, expiresAt),
    posterUrl,
    accessExpiresAt: expiresAt,
  };
}

export const listVideoModerationQueue = onCall<
  ListVideoModerationQueueRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ListVideoModerationQueueResponse> => {
    assertAdmin(request.auth);

    const queueLimit = normalizeLimit(request.data?.limit);
    const snapshot = await db
      .collectionGroup('public_videos')
      .where('moderationStatus', '==', 'PENDING_REVIEW')
      .limit(queueLimit)
      .get();
    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    let skippedItems = 0;

    const resolvedItems = await Promise.all(
      snapshot.docs.map(async (videoDoc) => {
        const ownerUid = cleanId(videoDoc.ref.parent.parent?.id);
        const videoId = cleanId(videoDoc.id);

        if (!ownerUid || !videoId) {
          skippedItems += 1;
          return null;
        }

        try {
          const item = await buildQueueItem(
            ownerUid,
            videoId,
            videoDoc.data() as PublicVideoDocument,
            expiresAt
          );

          if (!item) {
            skippedItems += 1;
          }

          return item;
        } catch (error) {
          skippedItems += 1;
          logger.warn('[listVideoModerationQueue] Item ignorado.', {
            ownerUid,
            videoId,
            error: error instanceof Error ? error.message : String(error ?? ''),
          });
          return null;
        }
      })
    );
    const items = resolvedItems
      .filter((item): item is AdminVideoModerationItem => !!item)
      .sort((left, right) => left.publishedAt - right.publishedAt);

    return { items, skippedItems };
  }
);

export const reviewVideoModeration = onCall<
  ReviewVideoModerationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ReviewVideoModerationResponse> => {
    const adminUid = assertAdmin(request.auth);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const decision = normalizeDecision(request.data?.decision);
    const reason = cleanReason(request.data?.reason);

    if (!ownerUid || !videoId || !decision) {
      throw new HttpsError('invalid-argument', 'Decisão de moderação inválida.');
    }

    if (decision === 'REJECT' && reason.length < 8) {
      throw new HttpsError(
        'invalid-argument',
        'Informe um motivo objetivo para rejeitar o vídeo.'
      );
    }

    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const [publicationSnap, publicVideoSnap] = await Promise.all([
      publicationRef.get(),
      publicVideoRef.get(),
    ]);

    if (!publicationSnap.exists || !publicVideoSnap.exists) {
      throw new HttpsError('not-found', 'Vídeo pendente não encontrado.');
    }

    const publication = publicationSnap.data() as VideoPublicationDocument;
    const publicVideo = publicVideoSnap.data() as PublicVideoDocument;

    if (
      publication.isPublished !== true ||
      publication.moderationStatus !== 'PENDING_REVIEW' ||
      publicVideo.moderationStatus !== 'PENDING_REVIEW'
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Este vídeo já foi revisado ou deixou a fila.'
      );
    }

    const adminLogRef = db.collection('admin_logs').doc();
    const timestamp = FieldValue.serverTimestamp();
    const batch = db.batch();

    if (decision === 'APPROVE') {
      batch.set(
        publicationRef,
        {
          moderationStatus: 'APPROVED',
          moderationReason: null,
          lastModeratedAt: timestamp,
          moderatedBy: adminUid,
          updatedAt: timestamp,
        },
        { merge: true }
      );
      batch.set(
        publicVideoRef,
        {
          moderationStatus: 'APPROVED',
          moderationReason: null,
          updatedAt: timestamp,
        },
        { merge: true }
      );
    } else {
      batch.set(
        publicationRef,
        {
          isPublished: false,
          visibility: 'PRIVATE',
          moderationStatus: 'REJECTED',
          moderationReason: reason,
          rejectedSourceStoragePath: publication.sourceStoragePath ?? null,
          lastModeratedAt: timestamp,
          moderatedBy: adminUid,
          publishedStoragePath: FieldValue.delete(),
          publishedPosterStoragePath: FieldValue.delete(),
          assetVersion: FieldValue.delete(),
          updatedAt: timestamp,
        },
        { merge: true }
      );
      batch.set(
        publicVideoRef,
        {
          visibility: 'PRIVATE',
          moderationStatus: 'REJECTED',
          moderationReason: reason,
          updatedAt: timestamp,
        },
        { merge: true }
      );
    }

    batch.set(adminLogRef, {
      adminUid,
      action: 'videoModerationReview',
      targetUserUid: ownerUid,
      details: {
        videoId,
        decision,
        previousStatus: 'PENDING_REVIEW',
        nextStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reason: reason || null,
      },
      timestamp,
    });

    await batch.commit();

    let cleanupPending = false;

    if (decision === 'REJECT') {
      const [videoDeleted, posterDeleted] = await Promise.all([
        deletePublishedVideoAssetOrQueue({
          ownerUid,
          videoId,
          storagePath: publication.publishedStoragePath,
          assetKind: 'video',
          reason: 'video-moderation-rejected',
        }),
        deletePublishedVideoAssetOrQueue({
          ownerUid,
          videoId,
          storagePath: publication.publishedPosterStoragePath,
          assetKind: 'poster',
          reason: 'video-moderation-rejected-poster',
        }),
      ]);

      cleanupPending = !videoDeleted || !posterDeleted;
      await db.recursiveDelete(publicVideoRef);
    }

    await refreshPublicProfileMediaMetrics(ownerUid);

    return {
      ownerUid,
      videoId,
      moderationStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      cleanupPending,
    };
  }
);
