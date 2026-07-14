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

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

/**
 * Sincroniza os metadados canônicos da publicação com a projeção pública.
 *
 * O callable de publicação usa este caminho antes de responder. O trigger
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

  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const publicVideoRef = db.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const privateVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
  const [publicationSnap, publicVideoSnap, privateVideoSnap] = await Promise.all([
    publicationRef.get(),
    publicVideoRef.get(),
    privateVideoRef.get(),
  ]);

  if (!publicationSnap.exists) {
    return;
  }

  const publication = publicationSnap.data() as VideoPublicationDoc;

  if (publication.isPublished !== true) {
    return;
  }

  if (!publicVideoSnap.exists) {
    logger.debug('[syncPublishedVideoSettings] Projeção pública ainda ausente.', {
      ownerUid,
      videoId,
    });
    return;
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

  await publicVideoRef.set(
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
