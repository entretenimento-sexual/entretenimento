import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  createVideoAudienceAccessEvaluator,
  resolveCanonicalVideoAudienceTarget,
  type PublicVideoAudienceDocument,
  type VideoPublicationAudienceDocument,
} from './video-audience-access.policy';

interface AuthorizePublicVideoShareRequest {
  ownerUid?: unknown;
  videoId?: unknown;
}

interface AuthorizePublicVideoShareResponse {
  ownerUid: string;
  videoId: string;
  canonicalPath: string;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

export const authorizePublicVideoShare =
  onCall<AuthorizePublicVideoShareRequest>(
    { region: FUNCTIONS_REGION },
    async (request): Promise<AuthorizePublicVideoShareResponse> => {
      const viewerUid = cleanId(request.auth?.uid);
      const ownerUid = cleanId(request.data?.ownerUid);
      const videoId = cleanId(request.data?.videoId);

      if (!viewerUid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      if (!ownerUid || !videoId) {
        throw new HttpsError('invalid-argument', 'Vídeo inválido.');
      }

      const audience = await createVideoAudienceAccessEvaluator(viewerUid);
      const publicProfileRef = db.doc(`public_profiles/${ownerUid}`);
      const publicVideoRef = publicProfileRef
        .collection('public_videos')
        .doc(videoId);
      const publicationRef = db.doc(
        `users/${ownerUid}/video_publications/${videoId}`
      );
      const [publicProfileSnapshot, publicVideoSnapshot, publicationSnapshot] =
        await Promise.all([
          publicProfileRef.get(),
          publicVideoRef.get(),
          publicationRef.get(),
        ]);

      if (
        !publicProfileSnapshot.exists ||
        !publicVideoSnapshot.exists ||
        !publicationSnapshot.exists
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Este vídeo não está disponível para compartilhamento.'
        );
      }

      const target = resolveCanonicalVideoAudienceTarget({
        ownerUid,
        videoId,
        action: 'SHARE',
        publicVideo:
          publicVideoSnapshot.data() as PublicVideoAudienceDocument,
        publication:
          publicationSnapshot.data() as VideoPublicationAudienceDocument,
      });

      if (!target) {
        throw new HttpsError(
          'failed-precondition',
          'Este vídeo não está disponível para compartilhamento.'
        );
      }

      await audience.assert(target);

      return {
        ownerUid,
        videoId,
        canonicalPath: `/media/video/${ownerUid}/${videoId}`,
      };
    }
  );
