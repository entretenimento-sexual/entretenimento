import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  MEDIA_RANKING_VERSION,
  normalizeMediaCount,
} from './media-engagement-score';
import {
  buildPhotoRankingUpdate,
  hasEquivalentPhotoRanking,
  isRankablePhoto,
  type PublicPhotoRankingDocument,
} from './photo-ranking-score';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';

const RANKING_REFRESH_LIMIT_PER_QUERY = 240;

function normalizeEnum(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function hasProfileAggregateInputChange(
  before: PublicPhotoRankingDocument | null,
  after: PublicPhotoRankingDocument
): boolean {
  if (!before) {
    return true;
  }

  return normalizeEnum(before.visibility) !== normalizeEnum(after.visibility) ||
    normalizeEnum(before.moderationStatus) !==
      normalizeEnum(after.moderationStatus) ||
    normalizeMediaCount(before.viewsCount) !==
      normalizeMediaCount(after.viewsCount) ||
    normalizeMediaCount(before.uniqueViewersCount) !==
      normalizeMediaCount(after.uniqueViewersCount) ||
    normalizeMediaCount(before.reactionsCount ?? before.likesCount) !==
      normalizeMediaCount(after.reactionsCount ?? after.likesCount) ||
    before.isCover !== after.isCover;
}

async function refreshOwnerProfile(ownerUidValue: unknown): Promise<void> {
  const ownerUid = String(ownerUidValue ?? '').trim();

  if (ownerUid) {
    await refreshPublicProfileMediaMetrics(ownerUid);
  }
}

export const recalculatePhotoRankingOnWrite = onDocumentWritten(
  {
    document: 'public_profiles/{ownerUid}/public_photos/{photoId}',
    region: FUNCTIONS_REGION,
    maxInstances: 20,
  },
  async (event) => {
    const beforeSnapshot = event.data?.before;
    const afterSnapshot = event.data?.after;
    const before = beforeSnapshot?.exists
      ? beforeSnapshot.data() as PublicPhotoRankingDocument
      : null;

    if (!afterSnapshot?.exists) {
      if (before && isRankablePhoto(before)) {
        await refreshOwnerProfile(event.params.ownerUid);
      }
      return;
    }

    const data = afterSnapshot.data() as PublicPhotoRankingDocument;

    if (!isRankablePhoto(data)) {
      if (
        (before && isRankablePhoto(before)) ||
        hasProfileAggregateInputChange(before, data)
      ) {
        await refreshOwnerProfile(event.params.ownerUid);
      }
      return;
    }

    const update = buildPhotoRankingUpdate(data, Date.now());
    const rankingChanged = !hasEquivalentPhotoRanking(data, update);
    const aggregateInputChanged = hasProfileAggregateInputChange(before, data);

    if (rankingChanged) {
      await afterSnapshot.ref.set(update, { merge: true });
    }

    if (rankingChanged || aggregateInputChanged) {
      await refreshOwnerProfile(event.params.ownerUid);
    }
  }
);

export const refreshPublicPhotoRankingScores = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
  },
  async () => {
    const rankablePhotos = db
      .collectionGroup('public_photos')
      .where('visibility', '==', 'PUBLIC')
      .where('moderationStatus', '==', 'APPROVED');
    const [topSnapshot, latestSnapshot] = await Promise.all([
      rankablePhotos
        .orderBy('score', 'desc')
        .limit(RANKING_REFRESH_LIMIT_PER_QUERY)
        .get(),
      rankablePhotos
        .orderBy('publishedAt', 'desc')
        .limit(RANKING_REFRESH_LIMIT_PER_QUERY)
        .get(),
    ]);
    const candidates = new Map<
      string,
      FirebaseFirestore.QueryDocumentSnapshot
    >();

    for (const document of [...topSnapshot.docs, ...latestSnapshot.docs]) {
      candidates.set(document.ref.path, document);
    }

    const now = Date.now();
    const batch = db.batch();
    let updatedPhotos = 0;

    for (const document of candidates.values()) {
      const data = document.data() as PublicPhotoRankingDocument;

      if (!isRankablePhoto(data)) {
        continue;
      }

      const update = buildPhotoRankingUpdate(data, now);

      if (hasEquivalentPhotoRanking(data, update)) {
        continue;
      }

      batch.set(document.ref, update, { merge: true });
      updatedPhotos += 1;
    }

    if (updatedPhotos > 0) {
      await batch.commit();
    }

    logger.info('[refreshPublicPhotoRankingScores] Ranking atualizado.', {
      scannedPhotos: candidates.size,
      updatedPhotos,
      rankingVersion: MEDIA_RANKING_VERSION,
    });
  }
);
