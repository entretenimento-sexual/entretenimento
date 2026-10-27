import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import { deleteProfilePhotoResources } from './delete-profile-photo.handler';
import { isExpiredFeedPhotoPending, isBenignFeedPhotoDeletionRace } from './failed-feed-photo.policy';

/** Recupera uploads registrados mas nunca confirmados pelo feed. */
export async function runExpiredFeedPhotoCleanupOnce(): Promise<void> {
  const now = Date.now();
  const snapshot = await db.collectionGroup('photos')
    .where('feedPublicationExpiresAtMs', '<=', now)
    .limit(50).get();
  let staged = 0, protectedCount = 0, heldForReview = 0, conflicts = 0, failures = 0;
  for (const photo of snapshot.docs) {
    const segments = photo.ref.path.split('/');
    if (segments.length !== 4 || segments[0] !== 'users' || segments[2] !== 'photos') continue;
    if (!isExpiredFeedPhotoPending(photo.data(), now)) continue;
    const ownerUid = segments[1];
    const photoId = segments[3];
    const pubRef = db.doc('users/' + ownerUid + '/photo_publications/' + photoId);
    const projectionRef = db.doc('public_profiles/' + ownerUid + '/public_photos/' + photoId);
    try {
      // Uma publicação confirmada nunca é alvo de descarte.
      const disposition = await db.runTransaction(async tx => {
        const [fresh, publication, projection] = await Promise.all([
          tx.get(photo.ref), tx.get(pubRef), tx.get(projectionRef),
        ]);
        if (!fresh.exists || !isExpiredFeedPhotoPending(fresh.data() ?? {}, now)) return 'skipped' as const;
        if (!publication.exists && !projection.exists) return 'delete' as const;
        if (publication.exists && projection.exists) {
          tx.update(photo.ref, {
            feedPublicationPending: FieldValue.delete(),
            feedPublicationExpiresAtMs: FieldValue.delete(),
          });
          return 'protected' as const;
        }
        // Projeção parcial: nunca apagar; retirar apenas do lote de expiração.
        // O intento permanece pendente e o registro exige revisão manual.
        tx.update(photo.ref, {
          feedPublicationExpiresAtMs: FieldValue.delete(),
          feedPublicationCleanupHoldAtMs: now,
        });
        return 'held' as const;
      });
      if (disposition !== 'delete') {
        if (disposition === 'held') {
          heldForReview++;
          logger.warn('[cleanupExpiredFeedPhotoUploads] Publicação parcial preservada para revisão.', {
            ownerUid, photoId,
          });
        } else {
          protectedCount++;
        }
        continue;
      }
      // Stage transacional, retry durável, exclusão por geração de Storage.
      await deleteProfilePhotoResources(ownerUid, photoId, { onlyIfUnpublished: true });
      staged++;
    } catch(error) {
      if (isBenignFeedPhotoDeletionRace(error)) {
        conflicts++;
        continue;
      }
      failures++;
      logger.error('[cleanupExpiredFeedPhotoUploads] Reconciliar novamente.', {
        ownerUid, photoId,
        error: error instanceof Error ? error.message.slice(0,300) : 'unknown',
      });
    }
  }
  logger.info('[cleanupExpiredFeedPhotoUploads] Resumo', {
    scanned: snapshot.size, staged, protectedCount, heldForReview, conflicts, failures,
  });
}

export const cleanupExpiredFeedPhotoUploads = onSchedule({
  region: FUNCTIONS_REGION,
  schedule: 'every 30 minutes',
  timeZone: 'America/Sao_Paulo',
  retryCount: 3,
}, runExpiredFeedPhotoCleanupOnce);
