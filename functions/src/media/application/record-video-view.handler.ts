import { createHash } from 'node:crypto';

import type { UserRecord } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { auth, db, FieldValue } from '../../firebaseApp';
import {
  PROFILE_VIEWER_INDEX_VERSION,
  PROFILE_VIEWERS_COLLECTION,
  calculatePublicProfileEngagementScore,
  ensurePublicProfileViewerIndex,
} from './public-profile-media-metrics';
import {
  assertCanonicalVideoAudienceContext,
  type VideoAudienceAuthContext,
} from './video-audience-context.policy';
import type {
  PublicVideoAudienceDocument,
  VideoPublicationAudienceDocument,
} from './video-audience-access.policy';
import {
  VideoViewPlaybackEvidenceInput,
  buildVideoViewCountDecision,
  normalizeVideoViewPlaybackEvidence,
} from './video-view-qualification';
import {
  evaluateVideoViewSession,
  type StoredVideoViewSession,
} from './video-view-session.policy';

interface RecordVideoViewRequest {
  ownerUid?: string;
  videoId?: string;
  source?: 'discover' | 'profile' | 'latest' | 'top' | 'boosted' | 'unknown';
  evidence?: VideoViewPlaybackEvidenceInput;
}

interface RecordVideoViewResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
  counted: boolean;
  uniqueViewer: boolean;
  retryAfterMs: number;
}

interface RelationshipDocument {
  readonly isBlocked?: unknown;
  readonly friendUid?: unknown;
}

type CanonicalRecord = Readonly<Record<string, unknown>>;

const VIEWER_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanSource(
  value: unknown
): NonNullable<RecordVideoViewRequest['source']> {
  const source = String(value ?? '').trim();

  if (
    source === 'discover' ||
    source === 'profile' ||
    source === 'latest' ||
    source === 'top' ||
    source === 'boosted'
  ) {
    return source;
  }

  return 'unknown';
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function calculateViewScore(input: {
  viewsCount: number;
  uniqueViewersCount: number;
  lastViewedAt: number;
  publishedAt: number;
}): number {
  const recencyBoost =
    Math.max(0, input.lastViewedAt - input.publishedAt) / 1_000_000_000;

  return Math.round(
    input.viewsCount * 4 +
      input.uniqueViewersCount * 6 +
      recencyBoost
  );
}

function hashPlaybackSession(input: {
  viewerUid: string;
  ownerUid: string;
  videoId: string;
  sessionId: string;
}): string {
  return createHash('sha256')
    .update([
      input.viewerUid,
      input.ownerUid,
      input.videoId,
      input.sessionId,
    ].join(':'))
    .digest('hex');
}

function hashAppId(appId: unknown): string {
  const normalized = String(appId ?? '').trim();

  if (!normalized) {
    return process.env.FUNCTIONS_EMULATOR === 'true' ? 'emulator' : '';
  }

  return createHash('sha256').update(normalized).digest('hex');
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

function sessionFailureMessage(reason: string | null): string {
  switch (reason) {
  case 'expired':
    return 'A sessão de visualização expirou.';
  case 'not_issued':
    return 'A sessão de visualização já foi utilizada.';
  case 'app_mismatch':
    return 'A sessão pertence a outra origem da aplicação.';
  default:
    return 'A sessão de visualização é inválida.';
  }
}

export const recordVideoView = onCall<RecordVideoViewRequest>(
  async (request): Promise<RecordVideoViewResponse> => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const source = cleanSource(request.data?.source);
    const sessionId = cleanId(request.data?.evidence?.sessionId);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId || !sessionId) {
      throw new HttpsError('invalid-argument', 'Vídeo ou sessão inválidos.');
    }

    if (viewerUid === ownerUid) {
      return {
        ok: true,
        ownerUid,
        videoId,
        counted: false,
        uniqueViewer: false,
        retryAfterMs: 0,
      };
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
    const ownerAuthUser = await readAuthUser(
      ownerUid,
      'Autor do vídeo não encontrado.'
    );
    const viewerAuth = authContext(viewerAuthUser);
    const ownerAuth = authContext(ownerAuthUser);
    const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
    const publicVideoRef = publicProfileRef.collection('public_videos').doc(videoId);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const sessionRef = db.doc(
      `users/${viewerUid}/video_view_sessions/${sessionId}`
    );
    const [preflightVideoSnapshot, preflightSessionSnapshot] =
      await Promise.all([publicVideoRef.get(), sessionRef.get()]);
    const preflightVideo = preflightVideoSnapshot.data();
    const preflightSession = preflightSessionSnapshot.exists
      ? preflightSessionSnapshot.data() as StoredVideoViewSession
      : null;
    const now = Date.now();
    const preflightSessionDecision = evaluateVideoViewSession({
      session: preflightSession,
      viewerUid,
      ownerUid,
      videoId,
      appIdHash,
      now,
    });

    if (!preflightSessionDecision.allowed) {
      throw new HttpsError(
        'failed-precondition',
        sessionFailureMessage(preflightSessionDecision.reason)
      );
    }

    const preflightDurationMs = safeNumber(
      preflightSession?.serverDurationMs ?? preflightVideo?.durationMs
    );
    const preflightEvidence = normalizeVideoViewPlaybackEvidence({
      evidence: request.data?.evidence,
      serverDurationMs: preflightDurationMs,
      now,
    });

    if (!preflightEvidence) {
      throw new HttpsError(
        'failed-precondition',
        'A reprodução ainda não atingiu o tempo mínimo para contabilização.'
      );
    }

    await ensurePublicProfileViewerIndex(ownerUid);

    const viewerRef = db.doc(`users/${viewerUid}`);
    const ownerRef = db.doc(`users/${ownerUid}`);
    const videoViewerRef = publicVideoRef.collection('views').doc(viewerUid);
    const profileViewerRef = publicProfileRef
      .collection(PROFILE_VIEWERS_COLLECTION)
      .doc(viewerUid);

    const outcome = await db.runTransaction(async (transaction) => {
      const [
        viewerSnapshot,
        ownerSnapshot,
        publicProfileSnap,
        publicVideoSnap,
        publicationSnapshot,
        sessionSnapshot,
        videoViewerSnap,
        profileViewerSnap,
      ] = await Promise.all([
        transaction.get(viewerRef),
        transaction.get(ownerRef),
        transaction.get(publicProfileRef),
        transaction.get(publicVideoRef),
        transaction.get(publicationRef),
        transaction.get(sessionRef),
        transaction.get(videoViewerRef),
        transaction.get(profileViewerRef),
      ]);

      if (!publicProfileSnap.exists) {
        throw new HttpsError('not-found', 'Perfil público não encontrado.');
      }

      const viewerUser = viewerSnapshot.exists
        ? viewerSnapshot.data() as CanonicalRecord
        : null;
      const ownerUser = ownerSnapshot.exists
        ? ownerSnapshot.data() as CanonicalRecord
        : null;
      const publicVideo = publicVideoSnap.exists
        ? publicVideoSnap.data() as PublicVideoAudienceDocument & CanonicalRecord
        : null;
      const publication = publicationSnapshot.exists
        ? publicationSnapshot.data() as VideoPublicationAudienceDocument & CanonicalRecord
        : null;
      const session = sessionSnapshot.exists
        ? sessionSnapshot.data() as StoredVideoViewSession
        : null;
      const sessionDecision = evaluateVideoViewSession({
        session,
        viewerUid,
        ownerUid,
        videoId,
        appIdHash,
        now,
      });

      if (!sessionDecision.allowed) {
        throw new HttpsError(
          'failed-precondition',
          sessionFailureMessage(sessionDecision.reason)
        );
      }

      const visibility = String(
        publicVideo?.visibility ?? publication?.visibility ?? ''
      ).trim().toUpperCase();
      const [viewerBlock, ownerBlock] = await Promise.all([
        transaction.get(viewerRef.collection('blocks').doc(ownerUid)),
        transaction.get(ownerRef.collection('blocks').doc(viewerUid)),
      ]);
      const viewerBlockedOwner = isBlocked(
        viewerBlock.data() as RelationshipDocument | undefined
      );
      const ownerBlockedViewer = isBlocked(
        ownerBlock.data() as RelationshipDocument | undefined
      );
      let bilateralFriendship = false;

      if (visibility === 'FRIENDS' && !viewerBlockedOwner && !ownerBlockedViewer) {
        const [viewerFriend, ownerFriend] = await Promise.all([
          transaction.get(viewerRef.collection('friends').doc(ownerUid)),
          transaction.get(ownerRef.collection('friends').doc(viewerUid)),
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

      const publicProfile = publicProfileSnap.data() ?? {};
      const videoData = publicVideoSnap.data() ?? {};
      const videoViewerData = videoViewerSnap.data() ?? {};
      const profileViewerData = profileViewerSnap.data() ?? {};
      const serverDurationMs = safeNumber(
        session?.serverDurationMs ?? videoData.durationMs
      );
      const evidence = normalizeVideoViewPlaybackEvidence({
        evidence: request.data?.evidence,
        serverDurationMs,
        now,
      });

      if (!evidence) {
        throw new HttpsError(
          'failed-precondition',
          'A reprodução não é válida para contabilização.'
        );
      }

      const requiredPlaybackMs = safeNumber(session?.requiredPlaybackMs);
      if (
        requiredPlaybackMs <= 0 ||
        evidence.playbackMs < requiredPlaybackMs
      ) {
        throw new HttpsError(
          'failed-precondition',
          'A reprodução ainda não atingiu o tempo mínimo da sessão.'
        );
      }

      const isUniqueVideoViewer = !videoViewerSnap.exists;
      const isUniqueProfileViewer = !profileViewerSnap.exists;
      const sessionHash = hashPlaybackSession({
        viewerUid,
        ownerUid,
        videoId,
        sessionId: evidence.sessionId,
      });
      const lastCountedAt = safeNumber(
        videoViewerData.lastCountedAt ?? videoViewerData.lastViewedAt
      );
      const countDecision = buildVideoViewCountDecision({
        now,
        isUniqueViewer: isUniqueVideoViewer,
        lastCountedAt,
        countWindowStartedAt: safeNumber(
          videoViewerData.countWindowStartedAt
        ),
        countWindowCount: safeNumber(videoViewerData.countWindowCount),
        samePlaybackSession:
          videoViewerData.lastCountedSessionHash === sessionHash,
      });
      const canCountView = countDecision.canCount;

      const currentVideoViewsCount = safeNumber(videoData.viewsCount);
      const currentVideoUniqueViewersCount = safeNumber(
        videoData.uniqueViewersCount
      );
      const currentVideoViewScore = safeNumber(videoData.viewScore);
      const nextVideoViewsCount = canCountView
        ? currentVideoViewsCount + 1
        : currentVideoViewsCount;
      const nextVideoUniqueViewersCount = isUniqueVideoViewer
        ? currentVideoUniqueViewersCount + 1
        : currentVideoUniqueViewersCount;
      const publishedAt = safeNumber(videoData.publishedAt) || now;
      const nextVideoViewScore = canCountView
        ? calculateViewScore({
          viewsCount: nextVideoViewsCount,
          uniqueViewersCount: nextVideoUniqueViewersCount,
          lastViewedAt: now,
          publishedAt,
        })
        : currentVideoViewScore;

      const currentProfileViewsCount = safeNumber(
        publicProfile.profileViewsCount ?? publicProfile.viewsCount
      );
      const currentProfileUniqueViewersCount = safeNumber(
        publicProfile.profileUniqueViewersCount ??
          publicProfile.uniqueViewersCount
      );
      const currentMediaUniqueViewersCount = safeNumber(
        publicProfile.mediaUniqueViewersCount
      );
      const currentProfileViewScore = safeNumber(publicProfile.viewScore);
      const nextProfileViewsCount = canCountView
        ? currentProfileViewsCount + 1
        : currentProfileViewsCount;
      const nextProfileUniqueViewersCount = isUniqueProfileViewer
        ? currentProfileUniqueViewersCount + 1
        : currentProfileUniqueViewersCount;
      const nextMediaUniqueViewersCount = isUniqueVideoViewer
        ? currentMediaUniqueViewersCount + 1
        : currentMediaUniqueViewersCount;
      const nextProfileViewScore = canCountView
        ? Math.max(
          0,
          currentProfileViewScore -
            currentVideoViewScore +
            nextVideoViewScore
        )
        : currentProfileViewScore;

      const engagementScore = calculatePublicProfileEngagementScore({
        mediaCount: safeNumber(
          publicProfile.mediaCount ?? publicProfile.publicMediaCount
        ),
        photosCount: safeNumber(
          publicProfile.photosCount ?? publicProfile.publicPhotosCount
        ),
        videosCount: safeNumber(
          publicProfile.videosCount ?? publicProfile.publicVideosCount
        ),
        viewsCount: nextProfileViewsCount,
        uniqueViewersCount: nextProfileUniqueViewersCount,
        reactionsCount: safeNumber(
          publicProfile.reactionsCount ??
            publicProfile.likesCount ??
            publicProfile.publicLikesCount
        ),
      });

      const shouldTouchVideoViewer =
        canCountView ||
        now - safeNumber(videoViewerData.lastViewedAt) >=
          VIEWER_TOUCH_INTERVAL_MS;
      const shouldTouchProfileViewer =
        canCountView ||
        isUniqueProfileViewer ||
        now - safeNumber(profileViewerData.lastViewedAt) >=
          VIEWER_TOUCH_INTERVAL_MS;

      transaction.update(sessionRef, {
        status: 'CONSUMED',
        consumedAt: now,
        counted: canCountView,
        qualifiedPlaybackMs: evidence.playbackMs,
        qualifiedDurationMs: evidence.durationMs,
      });

      if (shouldTouchVideoViewer) {
        transaction.set(
          videoViewerRef,
          {
            ownerUid,
            videoId,
            viewerUid,
            source,
            firstViewedAt: isUniqueVideoViewer
              ? now
              : videoViewerData.firstViewedAt ?? now,
            lastViewedAt: now,
            lastQualifiedPlaybackMs: evidence.playbackMs,
            lastQualifiedDurationMs: evidence.durationMs,
            ...(canCountView
              ? {
                lastCountedAt: now,
                lastCountedSessionHash: sessionHash,
                countWindowStartedAt:
                  countDecision.nextCountWindowStartedAt,
                countWindowCount: countDecision.nextCountWindowCount,
                viewsCount: FieldValue.increment(1),
              }
              : {}),
          },
          { merge: true }
        );
      }

      if (shouldTouchProfileViewer) {
        transaction.set(
          profileViewerRef,
          {
            ownerUid,
            viewerUid,
            firstViewedAt: isUniqueProfileViewer
              ? now
              : profileViewerData.firstViewedAt ??
                profileViewerData.historicalFirstViewedAt ??
                now,
            lastViewedAt: now,
            lastSource: source,
            indexVersion: PROFILE_VIEWER_INDEX_VERSION,
            ...(canCountView
              ? {
                lastCountedAt: now,
                viewsCount: FieldValue.increment(1),
              }
              : {}),
          },
          { merge: true }
        );
      }

      if (canCountView) {
        transaction.set(
          publicVideoRef,
          {
            viewsCount: nextVideoViewsCount,
            uniqueViewersCount: nextVideoUniqueViewersCount,
            lastViewedAt: now,
            viewScore: nextVideoViewScore,
          },
          { merge: true }
        );
      }

      if (canCountView || isUniqueProfileViewer) {
        transaction.set(
          publicProfileRef,
          {
            viewsCount: nextProfileViewsCount,
            profileViewsCount: nextProfileViewsCount,
            uniqueViewersCount: nextProfileUniqueViewersCount,
            profileUniqueViewersCount: nextProfileUniqueViewersCount,
            mediaUniqueViewersCount: nextMediaUniqueViewersCount,
            viewScore: nextProfileViewScore,
            engagementScore,
            lastViewedAt: now,
            profileViewerIndexVersion: PROFILE_VIEWER_INDEX_VERSION,
            mediaMetricsUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return {
        counted: canCountView,
        uniqueViewer: isUniqueVideoViewer,
        retryAfterMs: countDecision.retryAfterMs,
      };
    });

    return {
      ok: true,
      ownerUid,
      videoId,
      ...outcome,
    };
  }
);
