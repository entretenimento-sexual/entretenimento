// functions/src/media/application/public-profile-media-metrics.ts
// -----------------------------------------------------------------------------
// PUBLIC PROFILE MEDIA METRICS
// -----------------------------------------------------------------------------
// Fonte canônica backend dos sinais públicos de mídia usados pelo discovery.
//
// Regras importantes:
// - uniqueViewersCount representa pessoas únicas do PERFIL;
// - mediaUniqueViewersCount representa a soma de pessoas únicas por mídia;
// - profile_viewers/{viewerUid} é um índice privado, determinístico e backend-only;
// - dados legados são reconstruídos uma única vez antes da versão atual;
// - nenhum documento de visualizador é enviado ao cliente ou ao NgRx.
// -----------------------------------------------------------------------------

import { db, FieldValue } from '../../firebaseApp';

export const PROFILE_VIEWER_INDEX_VERSION = 1;
export const PROFILE_VIEWERS_COLLECTION = 'profile_viewers';

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
  mediaUniqueViewersCount: number;
  reactionsCount: number;
  aggregateViewScore: number;
  coverId: string | null;
  coverURL: string | null;
}

interface ProfileViewerAggregate {
  viewerUid: string;
  firstViewedAt: number;
  lastViewedAt: number;
  viewsCount: number;
}

interface LegacyProfileViewerIndex {
  viewers: Map<string, ProfileViewerAggregate>;
  mediaUniqueViewersCount: number;
}

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function safeInteger(value: unknown): number {
  return Math.floor(safeNumber(value));
}

function toEpoch(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (value instanceof Date) {
    const epoch = value.getTime();
    return Number.isFinite(epoch) ? Math.max(0, epoch) : 0;
  }

  const timestampLike = value as { toMillis?: () => number } | null | undefined;

  if (typeof timestampLike?.toMillis === 'function') {
    const epoch = timestampLike.toMillis();
    return Number.isFinite(epoch) ? Math.max(0, Math.floor(epoch)) : 0;
  }

  return 0;
}

function emptyAggregate(): MediaMetricAggregate {
  return {
    count: 0,
    viewsCount: 0,
    mediaUniqueViewersCount: 0,
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
    mediaUniqueViewersCount:
      base.mediaUniqueViewersCount + next.mediaUniqueViewersCount,
    reactionsCount: base.reactionsCount + next.reactionsCount,
    aggregateViewScore: base.aggregateViewScore + next.aggregateViewScore,
    coverId: base.coverId ?? next.coverId,
    coverURL: base.coverURL ?? next.coverURL,
  };
}

export function calculatePublicProfileEngagementScore(input: {
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
  const uniqueScore =
    Math.min(1, Math.log10(input.uniqueViewersCount + 1) / 4) * 24;
  const reactionScore =
    Math.min(1, Math.log10(input.reactionsCount + 1) / 3) * 16;

  return Math.round(
    mediaScore + videoScore + viewScore + uniqueScore + reactionScore
  );
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
    aggregate.mediaUniqueViewersCount += safeNumber(
      item.uniqueViewersCount
    );
    aggregate.reactionsCount += safeNumber(
      item.reactionsCount ?? item.likesCount
    );
    aggregate.aggregateViewScore += safeNumber(item.viewScore ?? item.score);

    if (item.isCover === true && !aggregate.coverId) {
      aggregate.coverId = cleanId(item.id) || docSnap.id;
      aggregate.coverURL = cleanId(item.url) || null;
    }
  });

  return aggregate;
}

async function countProfileViewers(
  publicProfileRef: FirebaseFirestore.DocumentReference
): Promise<number> {
  const countSnapshot = await publicProfileRef
    .collection(PROFILE_VIEWERS_COLLECTION)
    .count()
    .get();

  return safeInteger(countSnapshot.data().count);
}

async function collectLegacyProfileViewers(
  ownerUid: string,
  publicProfileRef: FirebaseFirestore.DocumentReference
): Promise<LegacyProfileViewerIndex> {
  const [photoSnapshot, videoSnapshot] = await Promise.all([
    publicProfileRef.collection('public_photos').get(),
    publicProfileRef.collection('public_videos').get(),
  ]);

  const mediaRefs = [
    ...photoSnapshot.docs.map((document) => document.ref),
    ...videoSnapshot.docs.map((document) => document.ref),
  ];
  const viewers = new Map<string, ProfileViewerAggregate>();
  let mediaUniqueViewersCount = 0;
  const readBatchSize = 20;

  for (let index = 0; index < mediaRefs.length; index += readBatchSize) {
    const viewerSnapshots = await Promise.all(
      mediaRefs
        .slice(index, index + readBatchSize)
        .map((mediaRef) => mediaRef.collection('views').get())
    );

    viewerSnapshots.forEach((snapshot) => {
      snapshot.docs.forEach((document) => {
        const data = document.data() ?? {};
        const viewerUid = cleanId(data.viewerUid) || document.id;

        if (!viewerUid || viewerUid === ownerUid) {
          return;
        }

        mediaUniqueViewersCount += 1;

        const firstViewedAt =
          toEpoch(data.firstViewedAt) ||
          toEpoch(data.createdAt) ||
          toEpoch(data.lastViewedAt);
        const lastViewedAt =
          toEpoch(data.lastViewedAt) ||
          toEpoch(data.lastCountedAt) ||
          firstViewedAt;
        const viewsCount = Math.max(1, safeInteger(data.viewsCount));
        const current = viewers.get(viewerUid);

        if (!current) {
          viewers.set(viewerUid, {
            viewerUid,
            firstViewedAt,
            lastViewedAt,
            viewsCount,
          });
          return;
        }

        viewers.set(viewerUid, {
          viewerUid,
          firstViewedAt:
            current.firstViewedAt && firstViewedAt
              ? Math.min(current.firstViewedAt, firstViewedAt)
              : current.firstViewedAt || firstViewedAt,
          lastViewedAt: Math.max(current.lastViewedAt, lastViewedAt),
          viewsCount: current.viewsCount + viewsCount,
        });
      });
    });
  }

  return {
    viewers,
    mediaUniqueViewersCount,
  };
}

async function persistProfileViewerIndex(
  ownerUid: string,
  publicProfileRef: FirebaseFirestore.DocumentReference,
  viewers: Map<string, ProfileViewerAggregate>
): Promise<void> {
  const entries = [...viewers.values()];
  const batchSize = 400;

  for (let index = 0; index < entries.length; index += batchSize) {
    const batch = db.batch();

    entries.slice(index, index + batchSize).forEach((viewer) => {
      const viewerRef = publicProfileRef
        .collection(PROFILE_VIEWERS_COLLECTION)
        .doc(viewer.viewerUid);

      /**
       * Campos históricos ficam separados dos campos vivos para que uma segunda
       * execução concorrente do backfill nunca sobrescreva uma view nova.
       */
      batch.set(
        viewerRef,
        {
          ownerUid,
          viewerUid: viewer.viewerUid,
          historicalFirstViewedAt: viewer.firstViewedAt,
          historicalLastViewedAt: viewer.lastViewedAt,
          historicalViewsCount: viewer.viewsCount,
          indexVersion: PROFILE_VIEWER_INDEX_VERSION,
          indexedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    await batch.commit();
  }
}

/**
 * Garante que a audiência única do perfil esteja indexada por viewerUid.
 *
 * Depois da migração, retorna o contador já consolidado no perfil e não executa
 * uma agregação adicional. A contagem exata do índice fica reservada ao refresh.
 */
export async function ensurePublicProfileViewerIndex(
  ownerUid: string
): Promise<number> {
  const safeOwnerUid = cleanId(ownerUid);

  if (!safeOwnerUid) {
    return 0;
  }

  const publicProfileRef = db.doc(`public_profiles/${safeOwnerUid}`);
  const profileSnapshot = await publicProfileRef.get();

  if (!profileSnapshot.exists) {
    return 0;
  }

  const profile = profileSnapshot.data() ?? {};
  const currentVersion = safeInteger(profile.profileViewerIndexVersion);

  if (currentVersion >= PROFILE_VIEWER_INDEX_VERSION) {
    return safeInteger(
      profile.profileUniqueViewersCount ?? profile.uniqueViewersCount
    );
  }

  const legacyIndex = await collectLegacyProfileViewers(
    safeOwnerUid,
    publicProfileRef
  );

  await persistProfileViewerIndex(
    safeOwnerUid,
    publicProfileRef,
    legacyIndex.viewers
  );

  const indexedCount = await countProfileViewers(publicProfileRef);

  await db.runTransaction(async (transaction) => {
    const latestProfileSnapshot = await transaction.get(publicProfileRef);

    if (!latestProfileSnapshot.exists) {
      return;
    }

    const latestVersion = safeInteger(
      latestProfileSnapshot.data()?.profileViewerIndexVersion
    );

    if (latestVersion >= PROFILE_VIEWER_INDEX_VERSION) {
      return;
    }

    transaction.set(
      publicProfileRef,
      {
        uniqueViewersCount: indexedCount,
        profileUniqueViewersCount: indexedCount,
        mediaUniqueViewersCount: legacyIndex.mediaUniqueViewersCount,
        profileViewerIndexVersion: PROFILE_VIEWER_INDEX_VERSION,
        profileViewerIndexBackfilledAt: FieldValue.serverTimestamp(),
        mediaMetricsUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return indexedCount;
}

export async function refreshPublicProfileMediaMetrics(
  ownerUid: string
): Promise<void> {
  const safeOwnerUid = cleanId(ownerUid);

  if (!safeOwnerUid) {
    return;
  }

  const publicProfileRef = db.doc(`public_profiles/${safeOwnerUid}`);

  await ensurePublicProfileViewerIndex(safeOwnerUid);

  const [photos, videos, indexedUniqueViewersCount] = await Promise.all([
    aggregateApprovedPublicMedia(publicProfileRef.collection('public_photos')),
    aggregateApprovedPublicMedia(publicProfileRef.collection('public_videos')),
    countProfileViewers(publicProfileRef),
  ]);

  const total = mergeAggregate(photos, videos);
  const photosCount = photos.count;
  const videosCount = videos.count;
  const mediaCount = photosCount + videosCount;

  await db.runTransaction(async (transaction) => {
    const profileSnapshot = await transaction.get(publicProfileRef);

    if (!profileSnapshot.exists) {
      return;
    }

    const profile = profileSnapshot.data() ?? {};
    const currentUniqueViewersCount = safeInteger(
      profile.profileUniqueViewersCount ?? profile.uniqueViewersCount
    );
    const uniqueViewersCount = Math.max(
      currentUniqueViewersCount,
      indexedUniqueViewersCount
    );

    const engagementScore = calculatePublicProfileEngagementScore({
      mediaCount,
      photosCount,
      videosCount,
      viewsCount: total.viewsCount,
      uniqueViewersCount,
      reactionsCount: total.reactionsCount,
    });

    transaction.set(
      publicProfileRef,
      {
        mediaCount,
        publicMediaCount: mediaCount,

        photosCount,
        publicPhotosCount: photosCount,

        videosCount,
        publicVideosCount: videosCount,

        viewsCount: total.viewsCount,
        profileViewsCount: total.viewsCount,

        uniqueViewersCount,
        profileUniqueViewersCount: uniqueViewersCount,
        mediaUniqueViewersCount: total.mediaUniqueViewersCount,

        reactionsCount: total.reactionsCount,
        likesCount: total.reactionsCount,
        publicLikesCount: total.reactionsCount,

        viewScore: total.aggregateViewScore,
        engagementScore,

        coverPhotoId: photos.coverId,
        coverPhotoURL: photos.coverURL,
        coverVideoId: videos.coverId,
        coverVideoURL: videos.coverURL,

        profileViewerIndexVersion: PROFILE_VIEWER_INDEX_VERSION,
        mediaMetricsUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}
