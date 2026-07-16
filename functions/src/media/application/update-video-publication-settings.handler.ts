import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccessInTransaction,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  hasVideoPublicationTextChanged,
  normalizeVideoPublicationSettings,
  type VideoPublicationSettingsInput,
} from './video-publication-settings';

interface UpdateVideoPublicationSettingsRequest
  extends VideoPublicationSettingsInput {
  ownerUid?: string;
  videoId?: string;
}

interface UpdateVideoPublicationSettingsResponse {
  videoId: string;
  moderationStatus: string;
  isPublished: boolean;
}

interface PrivateVideoDoc {
  fileName?: string;
}

interface VideoPublicationDoc extends VideoPublicationSettingsInput {
  ownerUid?: string;
  videoId?: string;
  isPublished?: boolean;
  moderationStatus?: string;
  moderationReason?: string | null;
}

const AUTO_APPROVE_VIDEOS =
  process.env.MEDIA_AUTO_APPROVE_VIDEOS === 'true';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function resolveModerationStatus(): 'APPROVED' | 'PENDING_REVIEW' {
  return AUTO_APPROVE_VIDEOS ? 'APPROVED' : 'PENDING_REVIEW';
}

export const updateVideoPublicationSettings =
  onCall<UpdateVideoPublicationSettingsRequest>(
    { region: FUNCTIONS_REGION },
    async (request): Promise<UpdateVideoPublicationSettingsResponse> => {
      const requesterUid = request.auth?.uid ?? null;
      const ownerUid = cleanId(request.data?.ownerUid);
      const videoId = cleanId(request.data?.videoId);

      if (!requesterUid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      if (!ownerUid || !videoId) {
        throw new HttpsError('invalid-argument', 'Vídeo inválido.');
      }

      if (requesterUid !== ownerUid) {
        throw new HttpsError(
          'permission-denied',
          'Você só pode editar vídeos do seu próprio perfil.'
        );
      }

      const privateVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
      const publicationRef = db.doc(
        `users/${ownerUid}/video_publications/${videoId}`
      );
      const publicVideoRef = db.doc(
        `public_profiles/${ownerUid}/public_videos/${videoId}`
      );

      return db.runTransaction(async (transaction) => {
        await assertInteractionAccessInTransaction(transaction, ownerUid);

        const [privateVideoSnap, publicationSnap, publicVideoSnap] =
          await Promise.all([
            transaction.get(privateVideoRef),
            transaction.get(publicationRef),
            transaction.get(publicVideoRef),
          ]);

        if (!privateVideoSnap.exists) {
          throw new HttpsError('not-found', 'Vídeo privado não encontrado.');
        }

        const privateVideo = privateVideoSnap.data() as PrivateVideoDoc;
        const currentPublication = publicationSnap.exists
          ? publicationSnap.data() as VideoPublicationDoc
          : null;
        const defaults = normalizeVideoPublicationSettings(
          currentPublication,
          {
            title: String(privateVideo.fileName ?? 'Vídeo').slice(0, 120),
            reactionsEnabled: true,
            commentsEnabled: true,
            ratingsEnabled: true,
          }
        );
        const nextSettings = normalizeVideoPublicationSettings(
          request.data,
          defaults
        );
        const textChanged = hasVideoPublicationTextChanged(
          defaults,
          nextSettings
        );
        const isPublished = currentPublication?.isPublished === true;
        const currentModerationStatus = String(
          currentPublication?.moderationStatus ?? 'PRIVATE'
        ).trim().toUpperCase();
        const moderationStatus = isPublished && textChanged
          ? resolveModerationStatus()
          : currentModerationStatus;
        const moderationReason = isPublished && textChanged
          ? null
          : currentPublication?.moderationReason ?? null;
        const now = Date.now();

        transaction.set(
          publicationRef,
          {
            ownerUid,
            videoId,
            isPublished,
            moderationStatus: isPublished ? moderationStatus : 'PRIVATE',
            ...nextSettings,
            moderationReason,
            updatedAt: now,
          },
          { merge: true }
        );

        if (isPublished && publicVideoSnap.exists) {
          const fallbackTitle = String(
            privateVideo.fileName ?? 'Vídeo do perfil'
          ).slice(0, 120);

          transaction.set(
            publicVideoRef,
            {
              title: nextSettings.title ?? fallbackTitle,
              description: nextSettings.description,
              reactionsEnabled: nextSettings.reactionsEnabled,
              commentsEnabled: nextSettings.commentsEnabled,
              ratingsEnabled: nextSettings.ratingsEnabled,
              moderationStatus,
              moderationReason: textChanged
                ? null
                : publicVideoSnap.get('moderationReason') ?? null,
              updatedAt: now,
            },
            { merge: true }
          );
        }

        return {
          videoId,
          moderationStatus: isPublished ? moderationStatus : 'PRIVATE',
          isPublished,
        };
      });
    }
  );
