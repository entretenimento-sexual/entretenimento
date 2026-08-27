import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { buildMediaEngagementScore } from './media-engagement-score';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import {
  PUBLIC_VIDEO_PLAYBACK_SESSION_COLLECTION,
  normalizePublicVideoPlaybackToken,
  validatePublicVideoPlaybackSession,
} from './public-video-playback-session';
import {
  PROFILE_VIEWER_INDEX_VERSION,
  PROFILE_VIEWERS_COLLECTION,
  calculatePublicProfileEngagementScore,
  ensurePublicProfileViewerIndex,
} from './public-profile-media-metrics';
import {
  calculateVideoViewScore,
  normalizeVideoAudienceScore,
} from './video-audience-score';
import { buildVideoRetentionAggregate } from './video-retention-score';
import {
  VIDEO_RETENTION_TOKEN_TTL_MS,
  createVideoRetentionToken,
  hashVideoRetentionToken,
} from './video-retention-token';
import {
  VideoViewPlaybackEvidenceInput,
  buildVideoViewCountDecision,
  normalizeVideoViewPlaybackEvidence,
} from './video-view-qualification';

interface RecordVideoViewRequest {
  ownerUid?: string;
  videoId?: string;
  source?: 'discover' | 'profile' | 'latest' | 'top' | 'boosted' | 'unknown';
  playbackToken?: string;
  evidence?: VideoViewPlaybackEvidenceInput;
}

interface RecordVideoViewResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
  counted: boolean;
  uniqueViewer: boolean;
  retryAfterMs: number;
  retentionToken: string | null;
  retentionTokenExpiresAt: number;
}

interface ValidatedPlaybackSession {
  tokenHash: string;
  issuedAt: number;
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

function safeRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
}

function resolveVideoVersion(
  data: FirebaseFirestore.DocumentData | undefined
): number {
  return safeNumber(data?.assetVersion ?? data?.publishedAt);
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

function assertPlaybackSession(input: {
  sessionData: FirebaseFirestore.DocumentData | undefined;
  playbackToken: string;
  viewerUid: string;
  ownerUid: string;
  videoId: string;
  videoVersion: number;
  requiredPlaybackMs: number;
  now: number;
}): ValidatedPlaybackSession {
  const validation = validatePublicVideoPlaybackSession({
    data: input.sessionData,
    playbackToken: input.playbackToken,
    viewerUid: input.viewerUid,
    ownerUid: input.ownerUid,
    videoId: input.videoId,
    videoVersion: input.videoVersion,
    now: input.now,
  });

  if (
    !validation.valid ||
    validation.requiredPlaybackMs !== input.requiredPlaybackMs
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Sessão de reprodução inválida, expirada ou ainda não qualificada.'
    );
  }

  return {
    tokenHash: validation.tokenHash,
    issuedAt: validation.issuedAt,
  };
}

export const recordVideoView = onCall<RecordVideoViewRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RecordVideoViewResponse> => {
    const viewerUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const source = cleanSource(request.data?.source);
    const playbackToken = normalizePublicVideoPlaybackToken(
      request.data?.playbackToken
    );

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    if (!playbackToken) {
      throw new HttpsError(
        'failed-precondition',
        'Sessão de reprodução ausente ou inválida.'
      );
    }

    await assertPublicMediaConsumptionAccess(viewerUid);

    if (viewerUid === ownerUid) {
      return {
        ok: true,
        ownerUid,
        videoId,
        counted: false,
        uniqueViewer: false,
        retryAfterMs: 0,
        retentionToken: null,
        retentionTokenExpiresAt: 0,
      };
    }

    const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const playbackSessionRef = publicVideoRef
      .collection(PUBLIC_VIDEO_PLAYBACK_SESSION_COLLECTION)
      .doc(viewerUid);
    const [preflightVideoSnapshot, preflightPlaybackSessionSnapshot] =
      await Promise.all([
        publicVideoRef.get(),
        playbackSessionRef.get(),
      ]);
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

    assertPlaybackSession({
      sessionData: preflightPlaybackSessionSnapshot.data(),
      playbackToken,
      viewerUid,
      ownerUid,
      videoId,
      videoVersion: resolveVideoVersion(preflightVideo),
      requiredPlaybackMs: preflightEvidence.requiredPlaybackMs,
      now,
    });

    await ensurePublicProfileViewerIndex(ownerUid);

    const videoViewerRef = publicVideoRef.collection('views').doc(viewerUid);
    const profileViewerRef = publicProfileRef
      .collection(PROFILE_VIEWERS_COLLECTION)
      .doc(viewerUid);
    const retentionToken = createVideoRetentionToken();
    const retentionTokenHash = hashVideoRetentionToken(retentionToken);
    const retentionTokenExpiresAt = now + VIDEO_RETENTION_TOKEN_TTL_MS;

    const outcome = await db.runTransaction(async (transaction) => {
      const publicProfileSnap = await transaction.get(publicProfileRef);
      const publicVideoSnap = await transaction.get(publicVideoRef);
      const playbackSessionSnap = await transaction.get(playbackSessionRef);
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

      const playbackSession = assertPlaybackSession({
        sessionData: playbackSessionSnap.data(),
        playbackToken,
        viewerUid,
        ownerUid,
        videoId,
        videoVersion: resolveVideoVersion(publicVideo),
        requiredPlaybackMs: evidence.requiredPlaybackMs,
        now,
      });
      const sessionHash = playbackSession.tokenHash;
      const isUniqueVideoViewer = !videoViewerSnap.exists;
      const isUniqueProfileViewer = !profileViewerSnap.exists;
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
      const nextVideoViewScore = canCountView
        ? calculateVideoViewScore({
          viewsCount: nextVideoViewsCount,
          uniqueViewersCount: nextVideoUniqueViewersCount,
        })
        : currentVideoViewScore;
      const nextVideoAudienceScore = normalizeVideoAudienceScore(
        nextVideoViewScore
      );
      const nextRetention = buildVideoRetentionAggregate({
        currentContributorsCount: publicVideo.retentionContributorsCount,
        currentBasisPointsTotal: publicVideo.retentionBasisPointsTotal,
        currentCompletionViewersCount: publicVideo.completionViewersCount,
        previousViewerBasisPoints:
          videoViewerData.bestQualifiedPlaybackBasisPoints,
        playbackMs: evidence.playbackMs,
        durationMs: evidence.durationMs,
      });
      const shouldUpdateVideoScore = canCountView || nextRetention.improved;
      const nextVideoRanking = shouldUpdateVideoScore
        ? buildMediaEngagementScore({
          reactionsCount: safeNumber(
            publicVideo.reactionsCount ?? publicVideo.likesCount
          ),
          commentsCount: safeNumber(publicVideo.commentsCount),
          ratingsCount: safeNumber(publicVideo.ratingsCount),
          ratingAverage: safeNumber(publicVideo.ratingAverage),
          currentBreakdown: {
            ...safeRecord(publicVideo.scoreBreakdown),
            audienceScore: nextVideoAudienceScore,
            retentionScore: nextRetention.retentionScore,
          },
        })
        : null;

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

      const shouldTouchProfileViewer =
        canCountView ||
        isUniqueProfileViewer ||
        now - safeNumber(profileViewerData.lastViewedAt) >=
          VIEWER_TOUCH_INTERVAL_MS;

      transaction.delete(playbackSessionRef);

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
          bestQualifiedPlaybackBasisPoints: nextRetention.viewerBasisPoints,
          retentionPlaybackStartedAt: playbackSession.issuedAt,
          retentionTokenHash,
          retentionTokenIssuedAt: now,
          retentionTokenExpiresAt,
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

      if (shouldUpdateVideoScore && nextVideoRanking) {
        transaction.set(
          publicVideoRef,
          {
            viewsCount: nextVideoViewsCount,
            uniqueViewersCount: nextVideoUniqueViewersCount,
            lastViewedAt: now,
            viewScore: nextVideoViewScore,
            audienceScore: nextVideoAudienceScore,
            retentionContributorsCount: nextRetention.contributorsCount,
            retentionBasisPointsTotal: nextRetention.basisPointsTotal,
            retentionAveragePercent: nextRetention.averagePercent,
            completionViewersCount: nextRetention.completionViewersCount,
            completionRate: nextRetention.completionRate,
            retentionScore: nextRetention.retentionScore,
            engagementScore: nextVideoRanking.engagementScore,
            score: nextVideoRanking.score,
            scoreBreakdown: nextVideoRanking.scoreBreakdown,
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
      retentionToken,
      retentionTokenExpiresAt,
      ...outcome,
    };
  }
);
