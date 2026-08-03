import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';

interface ReorderProfileVideosRequest {
  ownerUid?: string;
  orderedVideoIds?: unknown;
}

interface ReorderProfileVideosResponse {
  updatedCount: number;
  unchanged: boolean;
}

const MAX_ORDERABLE_VIDEOS = 60;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeOrderedVideoIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ORDERABLE_VIDEOS) {
    throw new HttpsError(
      'invalid-argument',
      'A ordem dos vídeos é inválida.'
    );
  }

  const normalized = value.map(cleanId);

  if (normalized.some((videoId) => !videoId)) {
    throw new HttpsError(
      'invalid-argument',
      'A lista contém um vídeo inválido.'
    );
  }

  if (new Set(normalized).size !== normalized.length) {
    throw new HttpsError(
      'invalid-argument',
      'A lista contém vídeos repetidos.'
    );
  }

  return normalized;
}

function sameIdentitySet(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((videoId) => rightSet.has(videoId));
}

export const reorderProfileVideos = onCall<ReorderProfileVideosRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ReorderProfileVideosResponse> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const orderedVideoIds = normalizeOrderedVideoIds(
      request.data?.orderedVideoIds
    );

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid) {
      throw new HttpsError('invalid-argument', 'Perfil inválido.');
    }

    if (requesterUid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'Você só pode organizar os vídeos do próprio perfil.'
      );
    }

    const publicationCollection = db.collection(
      `users/${ownerUid}/video_publications`
    );

    return db.runTransaction<ReorderProfileVideosResponse>(
      async (transaction) => {
        const publicationSnapshot = await transaction.get(
          publicationCollection
        );
        const publishedDocuments = publicationSnapshot.docs.filter(
          (document) => {
            const data = document.data();
            return data['isPublished'] === true &&
              String(data['moderationStatus'] ?? '')
                .trim()
                .toUpperCase() === 'APPROVED';
          }
        );
        const publishedVideoIds = publishedDocuments.map(
          (document) => document.id
        );

        if (!sameIdentitySet(orderedVideoIds, publishedVideoIds)) {
          throw new HttpsError(
            'failed-precondition',
            'A biblioteca mudou. Atualize a página antes de reorganizar.'
          );
        }

        if (orderedVideoIds.length === 0) {
          return { updatedCount: 0, unchanged: true };
        }

        const publicRefs = orderedVideoIds.map((videoId) =>
          db.doc(`public_profiles/${ownerUid}/public_videos/${videoId}`)
        );
        const publicSnapshots = await Promise.all(
          publicRefs.map((reference) => transaction.get(reference))
        );

        if (publicSnapshots.some((snapshot) => !snapshot.exists)) {
          throw new HttpsError(
            'failed-precondition',
            'Um dos vídeos ainda não possui projeção pública.'
          );
        }

        const publicationById = new Map(
          publishedDocuments.map((document) => [
            document.id,
            document.data(),
          ])
        );
        const currentOrder = [...publishedVideoIds].sort(
          (leftId, rightId) => {
            const left = publicationById.get(leftId);
            const right = publicationById.get(rightId);
            const leftOrder = Number(left?.['orderIndex'] ?? 0);
            const rightOrder = Number(right?.['orderIndex'] ?? 0);

            if (leftOrder !== rightOrder) {
              return leftOrder - rightOrder;
            }

            const leftPublishedAt = Number(left?.['publishedAt'] ?? 0);
            const rightPublishedAt = Number(right?.['publishedAt'] ?? 0);
            return rightPublishedAt - leftPublishedAt;
          }
        );
        const unchanged = currentOrder.every(
          (videoId, index) => videoId === orderedVideoIds[index]
        );

        if (unchanged) {
          return { updatedCount: 0, unchanged: true };
        }

        const now = Date.now();

        orderedVideoIds.forEach((videoId, orderIndex) => {
          transaction.set(
            db.doc(`users/${ownerUid}/video_publications/${videoId}`),
            { orderIndex, updatedAt: now },
            { merge: true }
          );
          transaction.set(
            db.doc(`public_profiles/${ownerUid}/public_videos/${videoId}`),
            { orderIndex, updatedAt: now },
            { merge: true }
          );
        });

        return {
          updatedCount: orderedVideoIds.length,
          unchanged: false,
        };
      }
    );
  }
);
