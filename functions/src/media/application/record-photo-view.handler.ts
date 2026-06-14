// functions/src/media/application/record-photo-view.handler.ts
// -----------------------------------------------------------------------------
// PHOTO VIEW TRACKING
// -----------------------------------------------------------------------------
// Registra visualizações públicas de fotos via backend confiável.
// O cliente não escreve viewsCount/viewScore diretamente na projeção pública.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

interface RecordPhotoViewRequest {
  ownerUid?: string;
  photoId?: string;
  source?: 'discover' | 'profile' | 'latest' | 'top' | 'boosted' | 'unknown';
}

interface RecordPhotoViewResponse {
  ok: true;
  ownerUid: string;
  photoId: string;
}

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanSource(value: unknown): NonNullable<RecordPhotoViewRequest['source']> {
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

function calculateViewScore(input: {
  viewsCount: number;
  uniqueViewersCount: number;
  lastViewedAt: number;
  publishedAt: number;
}): number {
  const recencyBoost = Math.max(0, input.lastViewedAt - input.publishedAt) / 1_000_000_000;

  return Math.round(
    input.viewsCount * 4 +
      input.uniqueViewersCount * 6 +
      recencyBoost
  );
}

export const recordPhotoView = onCall<RecordPhotoViewRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RecordPhotoViewResponse> => {
    const viewerUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);
    const source = cleanSource(request.data?.source);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    const now = Date.now();

    const publicPhotoRef = db.doc(`public_profiles/${ownerUid}/public_photos/${photoId}`);
    const viewerRef = publicPhotoRef.collection('views').doc(viewerUid);

    await db.runTransaction(async (transaction) => {
      const publicPhotoSnap = await transaction.get(publicPhotoRef);

      if (!publicPhotoSnap.exists) {
        throw new HttpsError('not-found', 'Foto pública não encontrada.');
      }

      const publicPhoto = publicPhotoSnap.data() ?? {};

      if (
        publicPhoto.visibility !== 'PUBLIC' ||
        publicPhoto.moderationStatus !== 'APPROVED'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Foto indisponível para visualização pública.'
        );
      }

      const viewerSnap = await transaction.get(viewerRef);
      const isUniqueView = !viewerSnap.exists;

      const currentViewsCount =
        typeof publicPhoto.viewsCount === 'number' ? publicPhoto.viewsCount : 0;

      const currentUniqueViewersCount =
        typeof publicPhoto.uniqueViewersCount === 'number'
          ? publicPhoto.uniqueViewersCount
          : 0;

      const nextViewsCount = currentViewsCount + 1;
      const nextUniqueViewersCount = isUniqueView
        ? currentUniqueViewersCount + 1
        : currentUniqueViewersCount;

      const publishedAt =
        typeof publicPhoto.publishedAt === 'number' ? publicPhoto.publishedAt : now;

      const viewScore = calculateViewScore({
        viewsCount: nextViewsCount,
        uniqueViewersCount: nextUniqueViewersCount,
        lastViewedAt: now,
        publishedAt,
      });

      transaction.set(
        publicPhotoRef,
        {
          viewsCount: nextViewsCount,
          uniqueViewersCount: nextUniqueViewersCount,
          lastViewedAt: now,
          viewScore,
          updatedAt: now,
        },
        { merge: true }
      );

      transaction.set(
        viewerRef,
        {
          viewerUid,
          source,
          firstViewedAt: isUniqueView
            ? now
            : viewerSnap.data()?.firstViewedAt ?? now,
          lastViewedAt: now,
          viewsCount: FieldValue.increment(1),
        },
        { merge: true }
      );
    });

    return {
      ok: true,
      ownerUid,
      photoId,
    };
  }
);
