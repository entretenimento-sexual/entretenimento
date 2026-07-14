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

export const syncPublishedVideoSettings = onDocumentWritten(
  {
    document: 'users/{ownerUid}/video_publications/{videoId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const ownerUid = cleanId(event.params.ownerUid);
    const videoId = cleanId(event.params.videoId);
    const after = event.data?.after;

    if (!ownerUid || !videoId || !after?.exists) {
      return;
    }

    const publication = after.data() as VideoPublicationDoc;

    if (publication.isPublished !== true) {
      return;
    }

    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const privateVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
    const [publicVideoSnap, privateVideoSnap] = await Promise.all([
      publicVideoRef.get(),
      privateVideoRef.get(),
    ]);

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
);
