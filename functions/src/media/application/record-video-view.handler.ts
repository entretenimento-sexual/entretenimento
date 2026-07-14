import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  PROFILE_VIEWER_INDEX_VERSION,
  PROFILE_VIEWERS_COLLECTION,
  calculatePublicProfileEngagementScore,
  ensurePublicProfileViewerIndex,
} from './public-profile-media-metrics';
import {
  VideoViewPlaybackEvidenceInput,
  buildVideoViewCountDecision,
  normalizeVideoViewPlaybackEvidence,
} from './video-view-qualification';

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

const VIEWER_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
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

function assertPublicApprovedVideo(
  exists: boolean,
  data: FirebaseFirestore.DocumentData | undefined
): void {
  if (!exists) {
    throw new HttpsError('not-found', 'Vídeo público não encontrado.');
  }

  if (
    data?.visibility !== 'PUBLIC' ||
    data?.moderationStatus !== 'APPROVED'
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Vídeo indisponível para visualização pública.'
    );
  }
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

export const recordVideoView = onCall<RecordVideoViewRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RecordVideoViewResponse> => {
    const viewerUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const source = cleanSource(request.data?.source);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
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

    const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const preflightVideoSnapshot = await publicVideoRef.get();
    const preflightVideo = preflightVideoSnapshot.data();
    const now = Date.now();

    assertPublicApprovedVideo(
      preflightVideoSnapshot.exists,
      preflightVideo
    );

    const preflightEvidence = normalizeVideoViewPlaybackEvidence({
      evidence: request.data?.evidence,
      serverDurationMs: safeNumber(preflightVideo?.durationMs),
      now,
    });

    if (!preflightEvidence) {
      throw new HttpsError(
        'failed-precondition',
        'A reprodução ainda não atingiu o tempo mínimo para contabilização.'
      );
    }

    await ensurePublicProfileViewerIndex(ownerUid);

    const videoViewerRef = publicVideoRef.collection('views').doc(viewerUid);
    const profileViewerRef = publicProfileRef
      .collection(PROFILE_VIEWERS_COLLECTION)
      .doc(viewerUid);

    const outcome = await db.runTransaction(async (transaction) => {
      const publicProfileSnap = await transaction.get(publicProfileRef);
      const publicVideoSnap = await transaction.get(publicVideoRef);
      const videoViewerSnap = await transaction.get(videoViewerRef);
      const profileViewerSnap = await transaction.get(profileViewerRef);

      if (!publicProfileSnap.exists) {
        throw new HttpsError('not-found', 'Perfil público não encontrado.');
      }

      assertPublicApprovedVideo(
        publicVideoSnap.exists,
        publicVideoSnap.data()
      );

      const publicProfile = publicProfileSnap.data() ?? {};
      const publicVideo = publicVideoSnap.data() ?? {};
      const videoViewerData = videoViewerSnap.data() ?? {};
      const profileViewerData = profileViewerSnap.data() ?? {};
      const evidence = normalizeVideoViewPlaybackEvidence({
        evidence: request.data?.evidence,
        serverDurationMs: safeNumber(publicVideo.durationMs),
        now,
      });

      if (!evidence) {
        throw new HttpsError(
          'failed-precondition',
          'A reprodução não é válida para contabilização.'
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

      const currentVideoViewsCount = safeNumber(publicVideo.viewsCount);
      const currentVideoUniqueViewersCount = safeNumber(
        publicVideo.uniqueViewersCount
      );
      const currentVideoViewScore = safeNumber(publicVideo.viewScore);
      const nextVideoViewsCount = canCountView
        ? currentVideoViewsCount + 1
        : currentVideoViewsCount;
      const nextVideoUniqueViewersCount = isUniqueVideoViewer
        ? currentVideoUniqueViewersCount + 1
        : currentVideoUniqueViewersCount;
      const publishedAt = safeNumber(publicVideo.publishedAt) || now;
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
