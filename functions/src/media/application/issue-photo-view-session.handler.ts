import { randomBytes } from 'node:crypto';

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { PROTECTED_CALLABLE_OPTIONS } from '../../config/protected-callable-options';
import { db } from '../../firebaseApp';
import {
  type PhotoPublicationAudienceDocument,
  type PublicPhotoAudienceDocument,
  resolveCanonicalPhotoAudienceTarget,
} from './photo-audience-access.policy';
import {
  PHOTO_VIEW_SESSION_GLOBAL_MAX_PER_WINDOW,
  PHOTO_VIEW_SESSION_PHOTO_MAX_PER_WINDOW,
  PHOTO_VIEW_SESSION_TTL_MS,
  buildPhotoViewSessionRateDecision,
  type PhotoViewSessionRateState,
} from './photo-view-session.policy';
import {
  PHOTO_VIEW_SESSION_COLLECTION,
  PHOTO_VIEW_SESSION_RATE_LIMIT_COLLECTION,
  cleanPhotoViewSource,
  getPhotoViewSessionRef,
  hashPhotoViewRateLimitKey,
} from './photo-view-session.store';
import {
  createVideoAudienceAccessEvaluator,
} from './video-audience-access.policy';

interface IssuePhotoViewSessionRequest {
  ownerUid?: unknown;
  photoId?: unknown;
  source?: unknown;
}

interface IssuePhotoViewSessionResponse {
  ok: true;
  ownerUid: string;
  photoId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

const CLEANUP_BATCH_LIMIT = 240;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanAppId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 && normalized.length <= 256
    ? normalized
    : '';
}

function getGlobalRateLimitRef(viewerUid: string) {
  return db.collection(PHOTO_VIEW_SESSION_RATE_LIMIT_COLLECTION).doc(
    hashPhotoViewRateLimitKey(`global:${viewerUid}`)
  );
}

function getPhotoRateLimitRef(
  viewerUid: string,
  ownerUid: string,
  photoId: string
) {
  return db.collection(PHOTO_VIEW_SESSION_RATE_LIMIT_COLLECTION).doc(
    hashPhotoViewRateLimitKey(`photo:${viewerUid}:${ownerUid}:${photoId}`)
  );
}

function rateState(
  data: FirebaseFirestore.DocumentData | undefined
): Partial<PhotoViewSessionRateState> {
  return {
    windowStartedAt: data?.windowStartedAt,
    count: data?.count,
    lastIssuedAt: data?.lastIssuedAt,
  };
}

function throwRateLimit(retryAfterMs: number): never {
  throw new HttpsError(
    'resource-exhausted',
    'Muitas sessões de visualização foram solicitadas. Tente novamente em instantes.',
    { retryAfterMs: Math.max(1_000, Math.ceil(retryAfterMs)) }
  );
}

export const issuePhotoViewSession = onCall<IssuePhotoViewSessionRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request): Promise<IssuePhotoViewSessionResponse> => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);
    const source = cleanPhotoViewSource(request.data?.source);
    const appId = cleanAppId(request.app?.appId);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    if (viewerUid === ownerUid) {
      throw new HttpsError(
        'failed-precondition',
        'Visualizações do próprio autor não são contabilizadas.'
      );
    }

    const audience = await createVideoAudienceAccessEvaluator(viewerUid);
    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const globalRateRef = getGlobalRateLimitRef(viewerUid);
    const photoRateRef = getPhotoRateLimitRef(viewerUid, ownerUid, photoId);
    const sessionId = randomBytes(32).toString('base64url');
    const sessionRef = getPhotoViewSessionRef(sessionId);
    const now = Date.now();
    const expiresAt = now + PHOTO_VIEW_SESSION_TTL_MS;

    await db.runTransaction(async (transaction) => {
      const [
        publicPhotoSnapshot,
        publicationSnapshot,
        globalRateSnapshot,
        photoRateSnapshot,
      ] = await Promise.all([
        transaction.get(publicPhotoRef),
        transaction.get(publicationRef),
        transaction.get(globalRateRef),
        transaction.get(photoRateRef),
      ]);

      if (!publicPhotoSnapshot.exists || !publicationSnapshot.exists) {
        throw new HttpsError('not-found', 'Foto pública não encontrada.');
      }

      const target = resolveCanonicalPhotoAudienceTarget({
        ownerUid,
        photoId,
        publicPhoto:
          publicPhotoSnapshot.data() as PublicPhotoAudienceDocument,
        publication:
          publicationSnapshot.data() as PhotoPublicationAudienceDocument,
      });

      if (!target) {
        throw new HttpsError(
          'failed-precondition',
          'A foto possui dados de publicação inconsistentes.'
        );
      }

      await audience.assertInTransaction(transaction, target);

      const globalDecision = buildPhotoViewSessionRateDecision({
        now,
        state: rateState(globalRateSnapshot.data()),
        maxPerWindow: PHOTO_VIEW_SESSION_GLOBAL_MAX_PER_WINDOW,
      });
      const photoDecision = buildPhotoViewSessionRateDecision({
        now,
        state: rateState(photoRateSnapshot.data()),
        maxPerWindow: PHOTO_VIEW_SESSION_PHOTO_MAX_PER_WINDOW,
      });

      if (!globalDecision.allowed || !photoDecision.allowed) {
        throwRateLimit(Math.max(
          globalDecision.retryAfterMs,
          photoDecision.retryAfterMs
        ));
      }

      transaction.set(globalRateRef, {
        scope: 'viewer',
        ...globalDecision.nextState,
        updatedAt: now,
      });
      transaction.set(photoRateRef, {
        scope: 'viewer-photo',
        ...photoDecision.nextState,
        updatedAt: now,
      });
      transaction.set(sessionRef, {
        viewerUid,
        ownerUid,
        photoId,
        source,
        appId: appId || null,
        issuedAt: now,
        expiresAt,
      });
    });

    return {
      ok: true,
      ownerUid,
      photoId,
      sessionId,
      issuedAt: now,
      expiresAt,
    };
  }
);

export const cleanupExpiredPhotoViewSessions = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
  },
  async () => {
    const now = Date.now();
    const rateLimitCutoff = now - RATE_LIMIT_RETENTION_MS;
    const [sessions, staleRateLimits] = await Promise.all([
      db.collection(PHOTO_VIEW_SESSION_COLLECTION)
        .where('expiresAt', '<=', now)
        .limit(CLEANUP_BATCH_LIMIT)
        .get(),
      db.collection(PHOTO_VIEW_SESSION_RATE_LIMIT_COLLECTION)
        .where('updatedAt', '<=', rateLimitCutoff)
        .limit(CLEANUP_BATCH_LIMIT)
        .get(),
    ]);

    if (sessions.empty && staleRateLimits.empty) {
      return;
    }

    const batch = db.batch();
    sessions.docs.forEach((document) => batch.delete(document.ref));
    staleRateLimits.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();

    logger.info('[cleanupExpiredPhotoViewSessions] Dados removidos.', {
      sessions: sessions.size,
      rateLimits: staleRateLimits.size,
    });
  }
);
