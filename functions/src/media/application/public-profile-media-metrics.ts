// functions/src/media/application/public-profile-media-metrics.ts
// -----------------------------------------------------------------------------
// PUBLIC PROFILE MEDIA METRICS
// -----------------------------------------------------------------------------
// Agrega sinais públicos de mídia para discovery/ranking.
// Roda somente no backend com Admin SDK.
// -----------------------------------------------------------------------------

import { db, FieldValue } from '../../firebaseApp';

interface PublicPhotoMetricDoc {
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
  photosCount: number;
  viewsCount: number;
  uniqueViewersCount: number;
  reactionsCount: number;
}): number {
  if (
    input.photosCount === 0 &&
    input.viewsCount === 0 &&
    input.uniqueViewersCount === 0 &&
    input.reactionsCount === 0
  ) {
    return 0;
  }

  const photoScore = Math.min(1, input.photosCount / 8) * 20;
  const viewScore = Math.min(1, Math.log10(input.viewsCount + 1) / 4) * 35;
  const uniqueScore = Math.min(1, Math.log10(input.uniqueViewersCount + 1) / 4) * 25;
  const reactionScore = Math.min(1, Math.log10(input.reactionsCount + 1) / 3) * 20;

  return Math.round(photoScore + viewScore + uniqueScore + reactionScore);
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
  let viewsCount = 0;
  let uniqueViewersCount = 0;
  let reactionsCount = 0;
  let aggregateViewScore = 0;

  let coverPhotoId: string | null = null;
  let coverPhotoURL: string | null = null;

  publicPhotosSnapshot.docs.forEach((docSnap) => {
    const photo = docSnap.data() as PublicPhotoMetricDoc;

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

  const engagementScore = calculateEngagementScore({
    photosCount,
    viewsCount,
    uniqueViewersCount,
    reactionsCount,
  });

  await publicProfileRef.set(
    {
      photosCount,
      publicPhotosCount: photosCount,
      publicMediaCount: photosCount,

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
