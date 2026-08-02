import type { CallableRequest } from 'firebase-functions/v2/https';
import { HttpsError } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import {
  MEDIA_RANKING_VERSION,
  buildMediaEngagementScore,
  normalizeMediaCount,
  normalizeMediaScore,
  normalizeMediaTotal,
  type MediaScoreBreakdown,
} from './media-engagement-score';
import {
  PROFILE_VIEWER_INDEX_VERSION,
  PROFILE_VIEWERS_COLLECTION,
  calculatePublicProfileEngagementScore,
  ensurePublicProfileViewerIndex,
} from './public-profile-media-metrics';
import {
  createVideoAudienceAccessEvaluator,
  resolveCanonicalVideoAudienceTarget,
  type PublicVideoAudienceDocument,
  type VideoPublicationAudienceDocument,
} from './video-audience-access.policy';
import {
  VideoViewPlaybackEvidenceInput,
  buildVideoViewCountDecision,
  normalizeVideoViewPlaybackEvidence,
} from './video-view-qualification';
import { normalizeVideoViewSessionToken } from './video-view-session.policy';
import {
  cleanVideoViewSource,
  getVideoViewSessionRef,
  hashVideoViewSessionToken,
  type VideoViewSessionDocument,
  type VideoViewSource,
} from './video-view-session.store';

export interface RecordVideoViewRequest {
  ownerUid?: string;
  videoId?: string;
  source?: VideoViewSource;
  evidence?: VideoViewPlaybackEvidenceInput;
}

export interface RecordVideoViewResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
  counted: boolean;
  uniqueViewer: boolean;
  retryAfterMs: number;
}

const VIEWER_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

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

function assertVideoViewSession(input: {
  session: VideoViewSessionDocument;
  viewerUid: string;
  ownerUid: string;
  videoId: string;
  source: VideoViewSource;
  appId: string;
  qualifiedAt: number;
  now: number;
}): void {
  const sessionViewerUid = cleanId(input.session.viewerUid);
  const sessionOwnerUid = cleanId(input.session.ownerUid);
  const sessionVideoId = cleanId(input.session.videoId);
  const sessionSource = cleanVideoViewSource(input.session.source);
  const sessionAppId = cleanAppId(input.session.appId);
  const issuedAt = safeNumber(input.session.issuedAt);
  const expiresAt = safeNumber(input.session.expiresAt);

  if (
    sessionViewerUid !== input.viewerUid ||
    sessionOwnerUid !== input.ownerUid ||
    sessionVideoId !== input.videoId ||
    sessionSource !== input.source ||
    !issuedAt ||
    !expiresAt ||
    input.now > expiresAt ||
    input.qualifiedAt < issuedAt ||
    input.qualifiedAt > expiresAt ||
    (sessionAppId && sessionAppId !== input.appId)
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A sessão de reprodução é inválida ou expirou.'
    );
  }
}

export async function recordVideoViewCore(
  request: CallableRequest<RecordVideoViewRequest>
): Promise<RecordVideoViewResponse> {
  const viewerUid = cleanId(request.auth?.uid);
  const ownerUid = cleanId(request.data?.ownerUid);
  const videoId = cleanId(request.data?.videoId);
  const source = cleanVideoViewSource(request.data?.source);
  const sessionId = normalizeVideoViewSessionToken(
    request.data?.evidence?.sessionId
  );
  const appId = cleanAppId(request.app?.appId);

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

  if (!sessionId) {
    throw new HttpsError(
      'failed-precondition',
      'Inicie uma sessão válida antes de registrar a visualização.'
    );
  }

  const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
  const publicVideoRef = db.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const sessionRef = getVideoViewSessionRef(sessionId);
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

  const audience = await createVideoAudienceAccessEvaluator(viewerUid);
  await ensurePublicProfileViewerIndex(ownerUid);

  const videoViewerRef = publicVideoRef.collection('views').doc(viewerUid);
  const profileViewerRef = publicProfileRef
    .collection(PROFILE_VIEWERS_COLLECTION)
    .doc(viewerUid);

  const outcome = await db.runTransaction(async (transaction) => {
    const [
      publicProfileSnap,
      publicVideoSnap,
      publicationSnap,
      videoViewerSnap,
      profileViewerSnap,
      sessionSnap,
    ] = await Promise.all([
      transaction.get(publicProfileRef),
      transaction.get(publicVideoRef),
      transaction.get(publicationRef),
      transaction.get(videoViewerRef),
      transaction.get(profileViewerRef),
      transaction.get(sessionRef),
    ]);

    if (!publicProfileSnap.exists) {
      throw new HttpsError('not-found', 'Perfil público não encontrado.');
    }

    assertPublicApprovedVideo(
      publicVideoSnap.exists,
      publicVideoSnap.data()
    );

    if (!publicationSnap.exists) {
      throw new HttpsError('not-found', 'Publicação do vídeo não encontrada.');
    }

    if (!sessionSnap.exists) {
      throw new HttpsError(
        'failed-precondition',
        'A sessão de reprodução já foi utilizada ou expirou.'
      );
    }

    const publicProfile = publicProfileSnap.data() ?? {};
    const publicVideo = publicVideoSnap.data() ?? {};
    const publication =
      publicationSnap.data() as VideoPublicationAudienceDocument;
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

    const target = resolveCanonicalVideoAudienceTarget({
      ownerUid,
      videoId,
      action: 'PLAY',
      publicVideo: publicVideo as PublicVideoAudienceDocument,
      publication,
    });

    if (!target) {
      throw new HttpsError(
        'failed-precondition',
        'O vídeo possui dados de publicação inconsistentes.'
      );
    }

    await audience.assertInTransaction(transaction, target);
    assertVideoViewSession({
      session: sessionSnap.data() as VideoViewSessionDocument,
      viewerUid,
      ownerUid,
      videoId,
      source,
      appId,
      qualifiedAt: evidence.qualifiedAt,
      now,
    });

    const isUniqueVideoViewer = !videoViewerSnap.exists;
    const isUniqueProfileViewer = !profileViewerSnap.exists;
    const sessionHash = hashVideoViewSessionToken(sessionId);
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

    const currentVideoViewsCount = normalizeMediaCount(
      publicVideo.viewsCount
    );
    const currentVideoUniqueViewersCount = normalizeMediaCount(
      publicVideo.uniqueViewersCount
    );
    const currentVideoViewScore = normalizeMediaScore(
      publicVideo.viewScore
    );
    const currentQualifiedViewsCount = normalizeMediaCount(
      publicVideo.qualifiedViewsCount
    );
    const currentTotalQualifiedPlaybackMs = normalizeMediaTotal(
      publicVideo.totalQualifiedPlaybackMs
    );
    const currentTotalQualifiedDurationMs = normalizeMediaTotal(
      publicVideo.totalQualifiedDurationMs
    );
    const nextVideoViewsCount = canCountView
      ? currentVideoViewsCount + 1
      : currentVideoViewsCount;
    const nextVideoUniqueViewersCount = isUniqueVideoViewer
      ? currentVideoUniqueViewersCount + 1
      : currentVideoUniqueViewersCount;
    const nextQualifiedViewsCount = canCountView
      ? currentQualifiedViewsCount + 1
      : currentQualifiedViewsCount;
    const nextTotalQualifiedPlaybackMs = canCountView
      ? currentTotalQualifiedPlaybackMs + Math.min(
        evidence.playbackMs,
        evidence.durationMs
      )
      : currentTotalQualifiedPlaybackMs;
    const nextTotalQualifiedDurationMs = canCountView
      ? currentTotalQualifiedDurationMs + evidence.durationMs
      : currentTotalQualifiedDurationMs;
    const publishedAt = safeNumber(publicVideo.publishedAt) || now;
    const nextVideoRanking = canCountView
      ? buildMediaEngagementScore({
        reactionsCount: normalizeMediaCount(
          publicVideo.reactionsCount ?? publicVideo.likesCount
        ),
        commentsCount: normalizeMediaCount(publicVideo.commentsCount),
        ratingsCount: normalizeMediaCount(publicVideo.ratingsCount),
        ratingAverage: publicVideo.ratingAverage,
        viewsCount: nextVideoViewsCount,
        uniqueViewersCount: nextVideoUniqueViewersCount,
        qualifiedViewsCount: nextQualifiedViewsCount,
        totalQualifiedPlaybackMs: nextTotalQualifiedPlaybackMs,
        totalQualifiedDurationMs: nextTotalQualifiedDurationMs,
        publishedAt,
        now,
        currentBreakdown: publicVideo.scoreBreakdown as
          Partial<MediaScoreBreakdown> | undefined,
      })
      : null;
    const nextVideoViewScore = nextVideoRanking?.viewScore ??
      currentVideoViewScore;

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

    transaction.delete(sessionRef);

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

    if (canCountView && nextVideoRanking) {
      transaction.set(
        publicVideoRef,
        {
          viewsCount: nextVideoViewsCount,
          uniqueViewersCount: nextVideoUniqueViewersCount,
          qualifiedViewsCount: nextQualifiedViewsCount,
          totalQualifiedPlaybackMs: nextTotalQualifiedPlaybackMs,
          totalQualifiedDurationMs: nextTotalQualifiedDurationMs,
          lastViewedAt: now,
          viewScore: nextVideoRanking.viewScore,
          retentionScore: nextVideoRanking.retentionScore,
          freshnessScore: nextVideoRanking.freshnessScore,
          engagementScore: nextVideoRanking.engagementScore,
          score: nextVideoRanking.score,
          scoreBreakdown: nextVideoRanking.scoreBreakdown,
          rankingVersion: MEDIA_RANKING_VERSION,
          rankingUpdatedAt: now,
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
