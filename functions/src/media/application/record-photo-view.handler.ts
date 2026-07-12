// functions/src/media/application/record-photo-view.handler.ts
// -----------------------------------------------------------------------------
// PHOTO VIEW TRACKING
// -----------------------------------------------------------------------------
// Registra visualizações públicas de fotos via backend confiável.
//
// Semântica:
// - viewsCount: visualizações contabilizadas respeitando janela antifraude;
// - uniqueViewersCount da foto: pessoas únicas daquela foto;
// - uniqueViewersCount do perfil: pessoas únicas em qualquer mídia do perfil;
// - profile_viewers/{viewerUid}: índice privado e backend-only da audiência real.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  PROFILE_VIEWER_INDEX_VERSION,
  PROFILE_VIEWERS_COLLECTION,
  calculatePublicProfileEngagementScore,
  ensurePublicProfileViewerIndex,
} from './public-profile-media-metrics';

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

const VIEW_COUNT_INTERVAL_MS = 5 * 60 * 1000;

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanSource(
  value: unknown
): NonNullable<RecordPhotoViewRequest['source']> {
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

function assertPublicApprovedPhoto(
  exists: boolean,
  data: FirebaseFirestore.DocumentData | undefined
): void {
  if (!exists) {
    throw new HttpsError('not-found', 'Foto pública não encontrada.');
  }

  if (
    data?.visibility !== 'PUBLIC' ||
    data?.moderationStatus !== 'APPROVED'
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Foto indisponível para visualização pública.'
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

    if (viewerUid === ownerUid) {
      return {
        ok: true,
        ownerUid,
        photoId,
      };
    }

    const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );

    /**
     * Preflight barato: impede que um photoId inexistente acione o backfill
     * histórico do perfil. A transação revalida o documento depois.
     */
    const preflightPhotoSnapshot = await publicPhotoRef.get();
    assertPublicApprovedPhoto(
      preflightPhotoSnapshot.exists,
      preflightPhotoSnapshot.data()
    );

    /**
     * Migração lazy e idempotente. Executa leitura histórica apenas enquanto o
     * perfil ainda não possui o índice canônico versionado.
     */
    await ensurePublicProfileViewerIndex(ownerUid);

    const now = Date.now();
    const photoViewerRef = publicPhotoRef.collection('views').doc(viewerUid);
    const profileViewerRef = publicProfileRef
      .collection(PROFILE_VIEWERS_COLLECTION)
      .doc(viewerUid);

    await db.runTransaction(async (transaction) => {
      const publicProfileSnap = await transaction.get(publicProfileRef);
      const publicPhotoSnap = await transaction.get(publicPhotoRef);
      const photoViewerSnap = await transaction.get(photoViewerRef);
      const profileViewerSnap = await transaction.get(profileViewerRef);

      if (!publicProfileSnap.exists) {
        throw new HttpsError('not-found', 'Perfil público não encontrado.');
      }

      assertPublicApprovedPhoto(
        publicPhotoSnap.exists,
        publicPhotoSnap.data()
      );

      const publicProfile = publicProfileSnap.data() ?? {};
      const publicPhoto = publicPhotoSnap.data() ?? {};
      const photoViewerData = photoViewerSnap.data() ?? {};
      const profileViewerData = profileViewerSnap.data() ?? {};

      const isUniquePhotoViewer = !photoViewerSnap.exists;
      const isUniqueProfileViewer = !profileViewerSnap.exists;
      const lastCountedAt = safeNumber(
        photoViewerData.lastCountedAt ?? photoViewerData.lastViewedAt
      );
      const canCountView =
        isUniquePhotoViewer || now - lastCountedAt >= VIEW_COUNT_INTERVAL_MS;

      const currentPhotoViewsCount = safeNumber(publicPhoto.viewsCount);
      const currentPhotoUniqueViewersCount = safeNumber(
        publicPhoto.uniqueViewersCount
      );
      const currentPhotoViewScore = safeNumber(publicPhoto.viewScore);

      const nextPhotoViewsCount = canCountView
        ? currentPhotoViewsCount + 1
        : currentPhotoViewsCount;
      const nextPhotoUniqueViewersCount = isUniquePhotoViewer
        ? currentPhotoUniqueViewersCount + 1
        : currentPhotoUniqueViewersCount;

      const publishedAt = safeNumber(publicPhoto.publishedAt) || now;
      const nextPhotoViewScore = canCountView
        ? calculateViewScore({
          viewsCount: nextPhotoViewsCount,
          uniqueViewersCount: nextPhotoUniqueViewersCount,
          lastViewedAt: now,
          publishedAt,
        })
        : currentPhotoViewScore;

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
      const nextMediaUniqueViewersCount = isUniquePhotoViewer
        ? currentMediaUniqueViewersCount + 1
        : currentMediaUniqueViewersCount;
      const nextProfileViewScore = canCountView
        ? Math.max(
          0,
          currentProfileViewScore -
              currentPhotoViewScore +
              nextPhotoViewScore
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
        photoViewerRef,
        {
          ownerUid,
          photoId,
          viewerUid,
          source,
          firstViewedAt: isUniquePhotoViewer
            ? now
            : photoViewerData.firstViewedAt ?? now,
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
          publicPhotoRef,
          {
            viewsCount: nextPhotoViewsCount,
            uniqueViewersCount: nextPhotoUniqueViewersCount,
            lastViewedAt: now,
            viewScore: nextPhotoViewScore,
            updatedAt: now,
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
      photoId,
    };
  }
);
