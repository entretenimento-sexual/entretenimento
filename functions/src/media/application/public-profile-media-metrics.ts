// functions/src/media/application/public-profile-media-metrics.ts
// -----------------------------------------------------------------------------
// PUBLIC PROFILE MEDIA METRICS
// -----------------------------------------------------------------------------
// Agrega sinais públicos de mídia para discovery/ranking.
// Roda somente no backend com Admin SDK.
// -----------------------------------------------------------------------------

import { db, FieldValue } from '../../firebaseApp';

interface PublicMediaMetricDoc {
  id?: string;
  url?: string;
  isCover?: boolean;
  viewsCount?: number;
  uniqueViewersCount?: number;
  reactionsCount?: number;
  viewScore?: number;
  score?: number;
}

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function calculateEngagementScore(input: {
  mediaCount: number;
  photosCount: number;
  videosCount: number;
  viewsCount: number;
  uniqueViewersCount: number;
  reactionsCount: number;
}): number {
  if (
    input.mediaCount === 0 &&
    input.viewsCount === 0 &&
    input.uniqueViewersCount === 0 &&
    input.reactionsCount === 0
  ) {
    return 0;
  }

  const mediaScore = Math.min(1, input.mediaCount / 10) * 20;
  const videoScore = Math.min(1, input.videosCount / 4) * 8;
  const viewScore = Math.min(1, Math.log10(input.viewsCount + 1) / 4) * 32;
  const uniqueScore = Math.min(1, Math.log10(input.uniqueViewersCount + 1) / 4) * 24;
  const reactionScore = Math.min(1, Math.log10(input.reactionsCount + 1) / 3) * 16;

  return Math.round(mediaScore + videoScore + viewScore + uniqueScore + reactionScore);
}

export async function refreshPublicProfileMediaMetrics(ownerUid: string): Promise<void> {
  const safeOwnerUid = cleanId(ownerUid);

  if (!safeOwnerUid) {
    return;
  }

  const publicProfileRef = db.doc(`public_profiles/${safeOwnerUid}`);
  const publicPhotosSnapshot = await publicProfileRef
    .collection('public_photos')
    .where('visibility', '==', 'PUBLIC')
    .where('moderationStatus', '==', 'APPROVED')
    .get();

  let photosCount = 0;
  const videosCount = 0;
  let viewsCount = 0;
  let uniqueViewersCount = 0;
  let reactionsCount = 0;
  let aggregateViewScore = 0;

  let coverPhotoId: string | null = null;
  let coverPhotoURL: string | null = null;

  publicPhotosSnapshot.docs.forEach((docSnap) => {
    const photo = docSnap.data() as PublicMediaMetricDoc;

    photosCount += 1;
    viewsCount += safeNumber(photo.viewsCount);
    uniqueViewersCount += safeNumber(photo.uniqueViewersCount);
    reactionsCount += safeNumber(photo.reactionsCount);
    aggregateViewScore += safeNumber(photo.viewScore ?? photo.score);

    if (photo.isCover === true && !coverPhotoId) {
      coverPhotoId = cleanId(photo.id) || docSnap.id;
      coverPhotoURL = cleanId(photo.url) || null;
    }
  });

  const mediaCount = photosCount + videosCount;
  const engagementScore = calculateEngagementScore({
    mediaCount,
    photosCount,
    videosCount,
    viewsCount,
    uniqueViewersCount,
    reactionsCount,
  });

  await publicProfileRef.set(
    {
      mediaCount,
      publicMediaCount: mediaCount,

      photosCount,
      publicPhotosCount: photosCount,

      videosCount,
      publicVideosCount: videosCount,

      viewsCount,
      profileViewsCount: viewsCount,
      uniqueViewersCount,
      reactionsCount,
      likesCount: reactionsCount,
      publicLikesCount: reactionsCount,

      viewScore: aggregateViewScore,
      engagementScore,

      coverPhotoId,
      coverPhotoURL,

      mediaMetricsUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
