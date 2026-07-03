// functions/src/media/application/public-profile-media-metrics.ts
// -----------------------------------------------------------------------------
// PUBLIC PROFILE MEDIA METRICS
// -----------------------------------------------------------------------------
// Fonte canônica backend dos sinais públicos de mídia usados pelo discovery.
//
// Responsabilidade:
// - agregar fotos públicas aprovadas;
// - agregar vídeos públicos aprovados, quando a coleção existir;
// - consolidar views, unique viewers, reações/likes e engagementScore;
// - gravar os campos agregados em public_profiles/{uid};
// - manter o front sem necessidade de varrer subcoleções para ranquear cards.
//
// Regra arquitetural:
// - discovery-profile-score.utils.ts consome os agregados;
// - DiscoveryCardEnrichmentService aplica o ranking;
// - esta função é a fonte canônica de métricas públicas de mídia.
//
// Observação:
// - public_videos é opcional neste momento. Se a subcoleção não existir, a query
//   retorna vazia e videosCount permanece 0, sem quebrar o fluxo atual de fotos.
// -----------------------------------------------------------------------------

import { db, FieldValue } from '../../firebaseApp';

interface PublicMediaMetricDoc {
  id?: string;
  url?: string;
  isCover?: boolean;
  viewsCount?: number;
  uniqueViewersCount?: number;
  reactionsCount?: number;
  likesCount?: number;
  viewScore?: number;
  score?: number;
}

interface MediaMetricAggregate {
  count: number;
  viewsCount: number;
  uniqueViewersCount: number;
  reactionsCount: number;
  aggregateViewScore: number;
  coverId: string | null;
  coverURL: string | null;
}

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function emptyAggregate(): MediaMetricAggregate {
  return {
    count: 0,
    viewsCount: 0,
    uniqueViewersCount: 0,
    reactionsCount: 0,
    aggregateViewScore: 0,
    coverId: null,
    coverURL: null,
  };
}

function mergeAggregate(
  base: MediaMetricAggregate,
  next: MediaMetricAggregate
): MediaMetricAggregate {
  return {
    count: base.count + next.count,
    viewsCount: base.viewsCount + next.viewsCount,
    uniqueViewersCount: base.uniqueViewersCount + next.uniqueViewersCount,
    reactionsCount: base.reactionsCount + next.reactionsCount,
    aggregateViewScore: base.aggregateViewScore + next.aggregateViewScore,
    coverId: base.coverId ?? next.coverId,
    coverURL: base.coverURL ?? next.coverURL,
  };
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

async function aggregateApprovedPublicMedia(
  collectionPath: FirebaseFirestore.CollectionReference
): Promise<MediaMetricAggregate> {
  const snapshot = await collectionPath
    .where('visibility', '==', 'PUBLIC')
    .where('moderationStatus', '==', 'APPROVED')
    .get();

  const aggregate = emptyAggregate();

  snapshot.docs.forEach((docSnap) => {
    const item = docSnap.data() as PublicMediaMetricDoc;

    aggregate.count += 1;
    aggregate.viewsCount += safeNumber(item.viewsCount);
    aggregate.uniqueViewersCount += safeNumber(item.uniqueViewersCount);
    aggregate.reactionsCount += safeNumber(item.reactionsCount ?? item.likesCount);
    aggregate.aggregateViewScore += safeNumber(item.viewScore ?? item.score);

    if (item.isCover === true && !aggregate.coverId) {
      aggregate.coverId = cleanId(item.id) || docSnap.id;
      aggregate.coverURL = cleanId(item.url) || null;
    }
  });

  return aggregate;
}

export async function refreshPublicProfileMediaMetrics(ownerUid: string): Promise<void> {
  const safeOwnerUid = cleanId(ownerUid);

  if (!safeOwnerUid) {
    return;
  }

  const publicProfileRef = db.doc(`public_profiles/${safeOwnerUid}`);

  const [photos, videos] = await Promise.all([
    aggregateApprovedPublicMedia(publicProfileRef.collection('public_photos')),
    aggregateApprovedPublicMedia(publicProfileRef.collection('public_videos')),
  ]);

  const total = mergeAggregate(photos, videos);
  const photosCount = photos.count;
  const videosCount = videos.count;
  const mediaCount = photosCount + videosCount;

  const engagementScore = calculateEngagementScore({
    mediaCount,
    photosCount,
    videosCount,
    viewsCount: total.viewsCount,
    uniqueViewersCount: total.uniqueViewersCount,
    reactionsCount: total.reactionsCount,
  });

  await publicProfileRef.set(
    {
      mediaCount,
      publicMediaCount: mediaCount,

      photosCount,
      publicPhotosCount: photosCount,

      videosCount,
      publicVideosCount: videosCount,

      viewsCount: total.viewsCount,
      profileViewsCount: total.viewsCount,
      uniqueViewersCount: total.uniqueViewersCount,
      reactionsCount: total.reactionsCount,
      likesCount: total.reactionsCount,
      publicLikesCount: total.reactionsCount,

      viewScore: total.aggregateViewScore,
      engagementScore,

      coverPhotoId: photos.coverId,
      coverPhotoURL: photos.coverURL,
      coverVideoId: videos.coverId,
      coverVideoURL: videos.coverURL,

      mediaMetricsUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
