import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { MEDIA_RANKING_VERSION } from './media-engagement-score';
import {
  buildPhotoRankingUpdate,
  hasEquivalentPhotoRanking,
  isRankablePhoto,
  type PublicPhotoRankingDocument,
} from './photo-ranking-score';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';

const RANKING_REFRESH_LIMIT_PER_QUERY = 240;
const PROFILE_REFRESH_CONCURRENCY = 20;

async function refreshChangedProfiles(
  ownerUids: readonly string[]
): Promise<void> {
  for (
    let index = 0;
    index < ownerUids.length;
    index += PROFILE_REFRESH_CONCURRENCY
  ) {
    await Promise.all(
      ownerUids
        .slice(index, index + PROFILE_REFRESH_CONCURRENCY)
        .map((ownerUid) => refreshPublicProfileMediaMetrics(ownerUid))
    );
  }
}

export const recalculatePhotoRankingOnWrite = onDocumentWritten(
  {
    document: 'public_profiles/{ownerUid}/public_photos/{photoId}',
    region: FUNCTIONS_REGION,
    maxInstances: 20,
  },
  async (event) => {
    const after = event.data?.after;

    if (!after?.exists) {
      return;
    }

    const data = after.data() as PublicPhotoRankingDocument;

    if (!isRankablePhoto(data)) {
      return;
    }

    const update = buildPhotoRankingUpdate(data, Date.now());

    if (hasEquivalentPhotoRanking(data, update)) {
      return;
    }

    await after.ref.set(update, { merge: true });

    const ownerUid = String(event.params.ownerUid ?? '').trim();
    if (ownerUid) {
      await refreshPublicProfileMediaMetrics(ownerUid);
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
    const changedOwners = new Set<string>();
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
      const ownerUid = document.ref.parent.parent?.id ?? '';
      if (ownerUid) {
        changedOwners.add(ownerUid);
      }
      updatedPhotos += 1;
    }

    if (updatedPhotos > 0) {
      await batch.commit();
      await refreshChangedProfiles([...changedOwners]);
    }

    logger.info('[refreshPublicPhotoRankingScores] Ranking atualizado.', {
      scannedPhotos: candidates.size,
      updatedPhotos,
      updatedProfiles: changedOwners.size,
      rankingVersion: MEDIA_RANKING_VERSION,
    });
  }
);
