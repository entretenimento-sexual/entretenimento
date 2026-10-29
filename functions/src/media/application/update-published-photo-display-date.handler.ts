import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import { consumeBackendRateLimitQuota } from
  '../../shared/security/backend-rate-limit.service';
import { assertMediaAuthoringEligibility } from
  './media-authoring-eligibility.service';
import { normalizeOwnedPublishedPhotoPath } from './photo-storage-path';

interface UpdatePublishedPhotoDisplayDateRequest {
  ownerUid?: unknown;
  photoId?: unknown;
  displayDate?: unknown;
  expectedAssetVersion?: unknown;
}

interface PublicationRecord {
  ownerUid?: unknown;
  photoId?: unknown;
  isPublished?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
  publishedStoragePath?: unknown;
  assetVersion?: unknown;
  publishedAt?: unknown;
}

interface ProjectionRecord {
  ownerUid?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
  assetVersion?: unknown;
  publishedAt?: unknown;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_DISPLAY_DATE_MS = 4_133_980_799_999;
const RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 10,
  sustainedWindowMs: 600_000,
  sustainedMax: 40,
});

function cleanId(value: unknown): string {
  const id = String(value ?? '').trim();
  return SAFE_ID.test(id) ? id : '';
}

/**
 * A data é organização exclusiva do proprietário. Não interfere em
 * audiência, classificação, score, publicação ou identidade do ativo.
 * O número da versão impede gravação sobre uma substituição concorrente.
 */
export function canUpdatePublishedPhotoDisplayDate(
  ownerUid: string,
  photoId: string,
  expectedVersion: number,
  publication: PublicationRecord | null,
  projection: ProjectionRecord | null
): boolean {
  if (!publication || !projection ||
      publication.ownerUid !== ownerUid ||
      publication.photoId !== photoId ||
      projection.ownerUid !== ownerUid ||
      publication.isPublished !== true ||
      !['PUBLIC', 'FRIENDS'].includes(String(publication.visibility)) ||
      publication.visibility !== projection.visibility ||
      publication.moderationStatus !== 'APPROVED' ||
      projection.moderationStatus !== 'APPROVED' ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion <= 0 ||
      Number(projection.assetVersion ?? projection.publishedAt) !== expectedVersion ||
      !normalizeOwnedPublishedPhotoPath(
        ownerUid, photoId, publication.publishedStoragePath
      )) {
    return false;
  }
  // Não consultar nem exigir users/{uid}/photos.
  return true;
}

export const updatePublishedPhotoDisplayDate =
  onCall<UpdatePublishedPhotoDisplayDateRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
    },
    async (request): Promise<{ photoId: string; displayDate: number | null }> => {
      assertCallableAppCheck(request.app);
      const requesterUid = cleanId(request.auth?.uid);
      const ownerUid = cleanId(request.data?.ownerUid);
      const photoId = cleanId(request.data?.photoId);
      const expectedVersion = request.data?.expectedAssetVersion;
      const displayDate = request.data?.displayDate;

      if (!requesterUid) {
        throw new HttpsError('unauthenticated', 'Sessão encerrada.');
      }
      if (!ownerUid || requesterUid !== ownerUid) {
        throw new HttpsError('permission-denied', 'Foto indisponível.');
      }
      if (!photoId || typeof expectedVersion !== 'number' ||
          !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0 ||
          !(displayDate === null || (
            typeof displayDate === 'number' &&
            Number.isSafeInteger(displayDate) &&
            displayDate >= 0 && displayDate <= MAX_DISPLAY_DATE_MS
          ))) {
        throw new HttpsError('invalid-argument', 'Data ou publicação inválida.');
      }

      await consumeBackendRateLimitQuota({
        action: 'update-published-photo-display-date',
        subject: ownerUid,
        config: RATE_LIMIT,
        message: 'Muitas alterações de data foram solicitadas.',
      });
      await assertMediaAuthoringEligibility(ownerUid);

      const publicationRef = db.doc(
        `users/${ownerUid}/photo_publications/${photoId}`
      );
      const projectionRef = db.doc(
        `public_profiles/${ownerUid}/public_photos/${photoId}`
      );
      const deletionRef = db.doc(
        `media_photo_deletion_jobs/${ownerUid}_${photoId}`
      );

      await db.runTransaction(async (tx) => {
        const [publicationSnap, projectionSnap, deletionSnap] =
          await Promise.all([
            tx.get(publicationRef),
            tx.get(projectionRef),
            tx.get(deletionRef),
          ]);
        const publication = publicationSnap.exists
          ? publicationSnap.data() as PublicationRecord : null;
        const projection = projectionSnap.exists
          ? projectionSnap.data() as ProjectionRecord : null;

        if (deletionSnap.exists ||
            !canUpdatePublishedPhotoDisplayDate(
              ownerUid, photoId, expectedVersion, publication, projection
            )) {
          throw new HttpsError(
            'failed-precondition',
            'A publicação mudou ou está protegida. Atualize a galeria.'
          );
        }

        // Não atualizar a projeção pública ou a revisão física do ativo.
        // null é explícito: limpar a data não reativa um valor privado legado.
        tx.update(publicationRef, {
          displayDate,
          displayDateUpdatedAt: Date.now(),
        });
      });

      return { photoId, displayDate: displayDate as number | null };
    }
  );
