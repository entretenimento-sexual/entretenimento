import { randomBytes } from 'node:crypto';

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { PROTECTED_CALLABLE_OPTIONS } from '../../config/protected-callable-options';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  createVideoAudienceAccessEvaluator,
  resolveCanonicalVideoAudienceTarget,
  type PublicVideoAudienceDocument,
  type VideoPublicationAudienceDocument,
} from './video-audience-access.policy';
import {
  VIDEO_VIEW_SESSION_GLOBAL_MAX_PER_WINDOW,
  VIDEO_VIEW_SESSION_TTL_MS,
  VIDEO_VIEW_SESSION_VIDEO_MAX_PER_WINDOW,
  buildVideoViewSessionRateDecision,
  type VideoViewSessionRateState,
} from './video-view-session.policy';
import {
  VIDEO_VIEW_SESSION_COLLECTION,
  VIDEO_VIEW_SESSION_RATE_LIMIT_COLLECTION,
  cleanVideoViewSource,
  getVideoViewSessionRef,
  hashVideoViewRateLimitKey,
} from './video-view-session.store';

interface IssueVideoViewSessionRequest {
  ownerUid?: unknown;
  videoId?: unknown;
  source?: unknown;
}

interface IssueVideoViewSessionResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
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
  return db.collection(VIDEO_VIEW_SESSION_RATE_LIMIT_COLLECTION).doc(
    hashVideoViewRateLimitKey(`global:${viewerUid}`)
  );
}

function getVideoRateLimitRef(
  viewerUid: string,
  ownerUid: string,
  videoId: string
) {
  return db.collection(VIDEO_VIEW_SESSION_RATE_LIMIT_COLLECTION).doc(
    hashVideoViewRateLimitKey(`video:${viewerUid}:${ownerUid}:${videoId}`)
  );
}

function rateState(
  data: FirebaseFirestore.DocumentData | undefined
): Partial<VideoViewSessionRateState> {
  return {
    windowStartedAt: data?.windowStartedAt,
    count: data?.count,
    lastIssuedAt: data?.lastIssuedAt,
  };
}

function throwRateLimit(retryAfterMs: number): never {
  throw new HttpsError(
    'resource-exhausted',
    'Muitas sessões de reprodução foram solicitadas. Tente novamente em instantes.',
    { retryAfterMs: Math.max(1_000, Math.ceil(retryAfterMs)) }
  );
}

export const issueVideoViewSession = onCall<IssueVideoViewSessionRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request): Promise<IssueVideoViewSessionResponse> => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const source = cleanVideoViewSource(request.data?.source);
    const appId = cleanAppId(request.app?.appId);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    if (viewerUid === ownerUid) {
      throw new HttpsError(
        'failed-precondition',
        'Visualizações do próprio autor não são contabilizadas.'
      );
    }

    const audience = await createVideoAudienceAccessEvaluator(viewerUid);
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const globalRateRef = getGlobalRateLimitRef(viewerUid);
    const videoRateRef = getVideoRateLimitRef(viewerUid, ownerUid, videoId);
    const sessionId = randomBytes(32).toString('base64url');
    const sessionRef = getVideoViewSessionRef(sessionId);
    const now = Date.now();
    const expiresAt = now + VIDEO_VIEW_SESSION_TTL_MS;

    await db.runTransaction(async (transaction) => {
      const [
        publicVideoSnapshot,
        publicationSnapshot,
        globalRateSnapshot,
        videoRateSnapshot,
      ] = await Promise.all([
        transaction.get(publicVideoRef),
        transaction.get(publicationRef),
        transaction.get(globalRateRef),
        transaction.get(videoRateRef),
      ]);

      if (!publicVideoSnapshot.exists || !publicationSnapshot.exists) {
        throw new HttpsError('not-found', 'Vídeo público não encontrado.');
      }

      const target = resolveCanonicalVideoAudienceTarget({
        ownerUid,
        videoId,
        action: 'PLAY',
        publicVideo:
          publicVideoSnapshot.data() as PublicVideoAudienceDocument,
        publication:
          publicationSnapshot.data() as VideoPublicationAudienceDocument,
      });

      if (!target) {
        throw new HttpsError(
          'failed-precondition',
          'O vídeo possui dados de publicação inconsistentes.'
        );
      }

      await audience.assertInTransaction(transaction, target);

      const globalDecision = buildVideoViewSessionRateDecision({
        now,
        state: rateState(globalRateSnapshot.data()),
        maxPerWindow: VIDEO_VIEW_SESSION_GLOBAL_MAX_PER_WINDOW,
      });
      const videoDecision = buildVideoViewSessionRateDecision({
        now,
        state: rateState(videoRateSnapshot.data()),
        maxPerWindow: VIDEO_VIEW_SESSION_VIDEO_MAX_PER_WINDOW,
      });

      if (!globalDecision.allowed || !videoDecision.allowed) {
        throwRateLimit(Math.max(
          globalDecision.retryAfterMs,
          videoDecision.retryAfterMs
        ));
      }

      transaction.set(globalRateRef, {
        scope: 'viewer',
        viewerUid,
        ...globalDecision.nextState,
        updatedAt: now,
      });
      transaction.set(videoRateRef, {
        scope: 'viewer-video',
        viewerUid,
        ownerUid,
        videoId,
        ...videoDecision.nextState,
        updatedAt: now,
      });
      transaction.set(sessionRef, {
        viewerUid,
        ownerUid,
        videoId,
        source,
        appId: appId || null,
        issuedAt: now,
        expiresAt,
      });
    });

    return {
      ok: true,
      ownerUid,
      videoId,
      sessionId,
      issuedAt: now,
      expiresAt,
    };
  }
);

export const cleanupExpiredVideoViewSessions = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
  },
  async () => {
    const now = Date.now();
    const rateLimitCutoff = now - RATE_LIMIT_RETENTION_MS;
    const [sessions, staleRateLimits] = await Promise.all([
      db.collection(VIDEO_VIEW_SESSION_COLLECTION)
        .where('expiresAt', '<=', now)
        .limit(CLEANUP_BATCH_LIMIT)
        .get(),
      db.collection(VIDEO_VIEW_SESSION_RATE_LIMIT_COLLECTION)
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

    logger.info('[cleanupExpiredVideoViewSessions] Dados removidos.', {
      sessions: sessions.size,
      rateLimits: staleRateLimits.size,
    });
  }
);
