import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  PROFILE_VIEWER_INDEX_VERSION,
  PROFILE_VIEWERS_COLLECTION,
  calculatePublicProfileEngagementScore,
  ensurePublicProfileViewerIndex,
} from './public-profile-media-metrics';

interface RecordVideoViewRequest {
  ownerUid?: string;
  videoId?: string;
  source?: 'discover' | 'profile' | 'latest' | 'top' | 'boosted' | 'unknown';
}

interface RecordVideoViewResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
}

const VIEW_COUNT_INTERVAL_MS = 5 * 60 * 1000;

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
      };
    }

    const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const preflightVideoSnapshot = await publicVideoRef.get();

    assertPublicApprovedVideo(
      preflightVideoSnapshot.exists,
      preflightVideoSnapshot.data()
    );

    await ensurePublicProfileViewerIndex(ownerUid);

    const now = Date.now();
    const videoViewerRef = publicVideoRef.collection('views').doc(viewerUid);
    const profileViewerRef = publicProfileRef
      .collection(PROFILE_VIEWERS_COLLECTION)
      .doc(viewerUid);

    await db.runTransaction(async (transaction) => {
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

      const isUniqueVideoViewer = !videoViewerSnap.exists;
      const isUniqueProfileViewer = !profileViewerSnap.exists;
      const lastCountedAt = safeNumber(
        videoViewerData.lastCountedAt ?? videoViewerData.lastViewedAt
      );
      const canCountView =
        isUniqueVideoViewer || now - lastCountedAt >= VIEW_COUNT_INTERVAL_MS;

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
          ...(canCountView
            ? {
              lastCountedAt: now,
              viewsCount: FieldValue.increment(1),
            }
            : {}),
        },
        { merge: true }
      );

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
    });

    return {
      ok: true,
      ownerUid,
      videoId,
    };
  }
);
