import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { normalizeVideoPublicationSettings } from './video-publication-settings';

interface VideoPublicationDoc {
  isPublished?: boolean;
  moderationStatus?: string;
  moderationReason?: string | null;
  title?: string | null;
  description?: string | null;
  reactionsEnabled?: boolean;
  commentsEnabled?: boolean;
  ratingsEnabled?: boolean;
}

interface PrivateVideoDoc {
  fileName?: string;
}

type SynchronizationOutcome =
  | 'UPDATED'
  | 'IGNORED_UNPUBLISHED'
  | 'PUBLIC_PROJECTION_MISSING';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

/**
 * Sincroniza os metadados canônicos da publicação com a projeção pública.
 *
 * A leitura e a escrita ficam na mesma transação para impedir que uma
 * despublicação concorrente seja revertida por um trigger iniciado antes dela.
 * O callable de publicação usa este caminho antes de responder; o trigger
 * permanece como reconciliação para alterações administrativas e legadas.
 */
export async function synchronizePublishedVideoSettings(
  rawOwnerUid: unknown,
  rawVideoId: unknown
): Promise<void> {
  const ownerUid = cleanId(rawOwnerUid);
  const videoId = cleanId(rawVideoId);

  if (!ownerUid || !videoId) {
    throw new Error('Identificadores inválidos para sincronização do vídeo.');
  }

  const outcome = await synchronizePublishedVideoSettingsInFirestore(db, ownerUid, videoId);
  if (outcome === 'PUBLIC_PROJECTION_MISSING') {
    logger.debug('[syncPublishedVideoSettings] Projeção pública ainda ausente.', {
      ownerUid, videoId,
    });
  }
}

/** Shared transactional implementation for production and emulator concurrency tests. */
export async function synchronizePublishedVideoSettingsInFirestore(
  firestore: Firestore, ownerUid: string, videoId: string
): Promise<SynchronizationOutcome> {
  const publicationRef = firestore.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const publicVideoRef = firestore.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const privateVideoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const identityRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  const deletionRef = firestore.collection('media_video_deletion_jobs').doc(`${ownerUid}_${videoId}`);

  return firestore.runTransaction<SynchronizationOutcome>(
    async (transaction) => {
      const [publicationSnap, publicVideoSnap, privateVideoSnap, identitySnap, deletionSnap] =
        await Promise.all([
          transaction.get(publicationRef),
          transaction.get(publicVideoRef),
          transaction.get(privateVideoRef),
          transaction.get(identityRef),
          transaction.get(deletionRef),
        ]);

      if (deletionSnap.exists || (identitySnap.exists && (
        identitySnap.get('state') !== 'REGISTERED' ||
        identitySnap.get('ownerUid') !== ownerUid ||
        identitySnap.get('videoId') !== videoId
      ))) return 'IGNORED_UNPUBLISHED';

      if (!publicationSnap.exists) {
        return 'IGNORED_UNPUBLISHED';
      }

      const publication = publicationSnap.data() as VideoPublicationDoc;

      if (publication.isPublished !== true) {
        return 'IGNORED_UNPUBLISHED';
      }

      if (!publicVideoSnap.exists) {
        return 'PUBLIC_PROJECTION_MISSING';
      }

      const privateVideo = privateVideoSnap.exists
        ? privateVideoSnap.data() as PrivateVideoDoc
        : null;
      const settings = normalizeVideoPublicationSettings(publication, {
        title: String(privateVideo?.fileName ?? 'Vídeo do perfil').slice(0, 120),
        reactionsEnabled: true,
        commentsEnabled: true,
        ratingsEnabled: true,
      });

      transaction.set(
        publicVideoRef,
        {
          title: settings.title ?? 'Vídeo do perfil',
          description: settings.description,
          reactionsEnabled: settings.reactionsEnabled,
          commentsEnabled: settings.commentsEnabled,
          ratingsEnabled: settings.ratingsEnabled,
          moderationStatus: String(
            publication.moderationStatus ?? 'PENDING_REVIEW'
          ).trim().toUpperCase(),
          moderationReason: publication.moderationReason ?? null,
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      return 'UPDATED';
    }
  );

}

export const syncPublishedVideoSettings = onDocumentWritten(
  {
    document: 'users/{ownerUid}/video_publications/{videoId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    if (!event.data?.after.exists) {
      return;
    }

    await synchronizePublishedVideoSettings(
      event.params.ownerUid,
      event.params.videoId
    );
  }
);
