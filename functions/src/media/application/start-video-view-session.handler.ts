import { createHash, randomUUID } from 'node:crypto';

import type { UserRecord } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { auth, db } from '../../firebaseApp';
import {
  assertCanonicalVideoAudienceContext,
  type VideoAudienceAuthContext,
} from './video-audience-context.policy';
import type {
  PublicVideoAudienceDocument,
  VideoPublicationAudienceDocument,
} from './video-audience-access.policy';
import { VIDEO_PUBLIC_CALLABLE_OPTIONS } from './video-callable-security.options';
import { calculateRequiredVideoPlaybackMs } from './video-view-qualification';
import {
  VIDEO_VIEW_RATE_LIMIT_GLOBAL_MAX,
  VIDEO_VIEW_RATE_LIMIT_PER_VIDEO_MAX,
  VIDEO_VIEW_RATE_LIMIT_WINDOW_MS,
  VIDEO_VIEW_SESSION_RETENTION_MS,
  VIDEO_VIEW_SESSION_TTL_MS,
  evaluateFixedWindowRateLimit,
} from './video-view-session.policy';

interface StartVideoViewSessionRequest {
  readonly ownerUid?: unknown;
  readonly videoId?: unknown;
}

interface StartVideoViewSessionResponse {
  readonly sessionId: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly durationMs: number;
  readonly requiredPlaybackMs: number;
  readonly expiresAt: number;
}

interface RelationshipDocument {
  readonly isBlocked?: unknown;
  readonly friendUid?: unknown;
}

type CanonicalRecord = Readonly<Record<string, unknown>>;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function authContext(user: UserRecord): VideoAudienceAuthContext {
  return {
    disabled: user.disabled === true,
    emailVerified: user.emailVerified === true,
  };
}

async function readAuthUser(uid: string, message: string): Promise<UserRecord> {
  try {
    return await auth.getUser(uid);
  } catch {
    throw new HttpsError('not-found', message);
  }
}

function hashAppId(appId: unknown): string {
  const normalized = String(appId ?? '').trim();

  if (!normalized) {
    return process.env.FUNCTIONS_EMULATOR === 'true' ? 'emulator' : '';
  }

  return createHash('sha256').update(normalized).digest('hex');
}

function rateLimitVideoKey(ownerUid: string, videoId: string): string {
  return `video_${createHash('sha256')
    .update(`${ownerUid}:${videoId}`)
    .digest('hex')}`;
}

function isBlocked(data: RelationshipDocument | undefined): boolean {
  return data?.isBlocked === true;
}

function isFriend(
  data: RelationshipDocument | undefined,
  documentId: string,
  expectedUid: string
): boolean {
  return cleanId(data?.friendUid ?? documentId) === expectedUid;
}

export const startVideoViewSession = onCall<StartVideoViewSessionRequest>(
  VIDEO_PUBLIC_CALLABLE_OPTIONS,
  async (request): Promise<StartVideoViewSessionResponse> => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    const appIdHash = hashAppId(request.app?.appId);
    if (!appIdHash) {
      throw new HttpsError(
        'failed-precondition',
        'Não foi possível validar a origem da aplicação.'
      );
    }

    const viewerAuthUser = await readAuthUser(
      viewerUid,
      'Conta do visitante não encontrada.'
    );
    const ownerAuthUser = ownerUid === viewerUid
      ? viewerAuthUser
      : await readAuthUser(ownerUid, 'Autor do vídeo não encontrado.');
    const viewerAuth = authContext(viewerAuthUser);
    const ownerAuth = authContext(ownerAuthUser);
    const sessionId = randomUUID().replace(/-/g, '_');
    const now = Date.now();
    const expiresAt = now + VIDEO_VIEW_SESSION_TTL_MS;
    const cleanupAfter = expiresAt + VIDEO_VIEW_SESSION_RETENTION_MS;
    const viewerRef = db.doc(`users/${viewerUid}`);
    const ownerRef = db.doc(`users/${ownerUid}`);
    const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
    const publicVideoRef = publicProfileRef.collection('public_videos').doc(videoId);
    const publicationRef = ownerRef.collection('video_publications').doc(videoId);
    const globalLimitRef = viewerRef
      .collection('video_view_rate_limits')
      .doc('session_global');
    const videoLimitRef = viewerRef
      .collection('video_view_rate_limits')
      .doc(rateLimitVideoKey(ownerUid, videoId));
    const sessionRef = viewerRef.collection('video_view_sessions').doc(sessionId);

    return db.runTransaction(async (transaction) => {
      const viewerSnapshotPromise = transaction.get(viewerRef);
      const ownerSnapshotPromise = ownerUid === viewerUid
        ? viewerSnapshotPromise
        : transaction.get(ownerRef);
      const [
        viewerSnapshot,
        ownerSnapshot,
        publicProfileSnapshot,
        publicVideoSnapshot,
        publicationSnapshot,
        globalLimitSnapshot,
        videoLimitSnapshot,
      ] = await Promise.all([
        viewerSnapshotPromise,
        ownerSnapshotPromise,
        transaction.get(publicProfileRef),
        transaction.get(publicVideoRef),
        transaction.get(publicationRef),
        transaction.get(globalLimitRef),
        transaction.get(videoLimitRef),
      ]);

      if (!publicProfileSnapshot.exists) {
        throw new HttpsError('not-found', 'Perfil público não encontrado.');
      }

      const viewerUser = viewerSnapshot.exists
        ? viewerSnapshot.data() as CanonicalRecord
        : null;
      const ownerUser = ownerSnapshot.exists
        ? ownerSnapshot.data() as CanonicalRecord
        : null;
      const publicVideo = publicVideoSnapshot.exists
        ? publicVideoSnapshot.data() as PublicVideoAudienceDocument & CanonicalRecord
        : null;
      const publication = publicationSnapshot.exists
        ? publicationSnapshot.data() as VideoPublicationAudienceDocument & CanonicalRecord
        : null;
      const visibility = String(
        publicVideo?.visibility ?? publication?.visibility ?? ''
      ).trim().toUpperCase();
      let viewerBlockedOwner = false;
      let ownerBlockedViewer = false;
      let bilateralFriendship = false;

      if (viewerUid !== ownerUid) {
        const viewerBlockRef = viewerRef.collection('blocks').doc(ownerUid);
        const ownerBlockRef = ownerRef.collection('blocks').doc(viewerUid);
        const [viewerBlock, ownerBlock] = await Promise.all([
          transaction.get(viewerBlockRef),
          transaction.get(ownerBlockRef),
        ]);
        viewerBlockedOwner = isBlocked(
          viewerBlock.data() as RelationshipDocument | undefined
        );
        ownerBlockedViewer = isBlocked(
          ownerBlock.data() as RelationshipDocument | undefined
        );

        if (visibility === 'FRIENDS' && !viewerBlockedOwner && !ownerBlockedViewer) {
          const viewerFriendRef = viewerRef.collection('friends').doc(ownerUid);
          const ownerFriendRef = ownerRef.collection('friends').doc(viewerUid);
          const [viewerFriend, ownerFriend] = await Promise.all([
            transaction.get(viewerFriendRef),
            transaction.get(ownerFriendRef),
          ]);
          bilateralFriendship =
            viewerFriend.exists &&
            ownerFriend.exists &&
            isFriend(
              viewerFriend.data() as RelationshipDocument | undefined,
              viewerFriend.id,
              ownerUid
            ) &&
            isFriend(
              ownerFriend.data() as RelationshipDocument | undefined,
              ownerFriend.id,
              viewerUid
            );
        }
      }

      assertCanonicalVideoAudienceContext({
        viewerUid,
        ownerUid,
        videoId,
        action: 'PLAY',
        viewerUser,
        ownerUser,
        viewerAuth,
        ownerAuth,
        publicVideo,
        publication,
        viewerBlockedOwner,
        ownerBlockedViewer,
        bilateralFriendship,
      });

      const durationMs = safeNumber(publicVideo?.durationMs);
      if (durationMs <= 0) {
        throw new HttpsError(
          'failed-precondition',
          'A duração canônica do vídeo não está disponível.'
        );
      }

      const globalDecision = evaluateFixedWindowRateLimit({
        state: globalLimitSnapshot.data(),
        now,
        windowMs: VIDEO_VIEW_RATE_LIMIT_WINDOW_MS,
        maxCount: VIDEO_VIEW_RATE_LIMIT_GLOBAL_MAX,
      });
      const videoDecision = evaluateFixedWindowRateLimit({
        state: videoLimitSnapshot.data(),
        now,
        windowMs: VIDEO_VIEW_RATE_LIMIT_WINDOW_MS,
        maxCount: VIDEO_VIEW_RATE_LIMIT_PER_VIDEO_MAX,
      });

      if (!globalDecision.allowed || !videoDecision.allowed) {
        throw new HttpsError(
          'resource-exhausted',
          'Muitas sessões de vídeo foram iniciadas. Aguarde antes de tentar novamente.',
          {
            retryAfterMs: Math.max(
              globalDecision.retryAfterMs,
              videoDecision.retryAfterMs
            ),
          }
        );
      }

      const requiredPlaybackMs = calculateRequiredVideoPlaybackMs(durationMs);
      const rateLimitCleanup = Timestamp.fromMillis(
        now + VIDEO_VIEW_RATE_LIMIT_WINDOW_MS + VIDEO_VIEW_SESSION_RETENTION_MS
      );

      transaction.set(globalLimitRef, {
        windowStartedAt: globalDecision.nextWindowStartedAt,
        count: globalDecision.nextCount,
        updatedAt: now,
        cleanupAfter: rateLimitCleanup,
      });
      transaction.set(videoLimitRef, {
        ownerUid,
        videoId,
        windowStartedAt: videoDecision.nextWindowStartedAt,
        count: videoDecision.nextCount,
        updatedAt: now,
        cleanupAfter: rateLimitCleanup,
      });
      transaction.create(sessionRef, {
        viewerUid,
        ownerUid,
        videoId,
        status: 'ISSUED',
        appIdHash,
        createdAt: now,
        expiresAtMs: expiresAt,
        expiresAt: Timestamp.fromMillis(expiresAt),
        cleanupAfter: Timestamp.fromMillis(cleanupAfter),
        requiredPlaybackMs,
        serverDurationMs: durationMs,
        consumedAt: null,
      });

      return {
        sessionId,
        ownerUid,
        videoId,
        durationMs,
        requiredPlaybackMs,
        expiresAt,
      };
    });
  }
);
