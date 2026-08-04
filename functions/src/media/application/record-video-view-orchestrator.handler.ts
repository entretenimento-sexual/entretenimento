import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { db } from '../../firebaseApp';
import { MEDIA_VIEW_CALLABLE_OPTIONS } from './media-app-check.options';
import {
  recordVideoView as recordVideoViewCore,
} from './record-video-view.handler';
import {
  evaluateVideoPlaybackSession,
  hashVideoPlaybackSessionToken,
  type VideoPlaybackSessionDocument,
} from './video-playback-session.policy';

const PLAYBACK_SESSIONS_COLLECTION = 'media_video_playback_sessions';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

async function consumePlaybackSession(params: {
  readonly playbackSessionToken: unknown;
  readonly viewerUid: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly appId: string | null;
}): Promise<void> {
  const tokenHash = hashVideoPlaybackSessionToken(
    params.playbackSessionToken
  );

  if (!tokenHash) {
    throw new HttpsError(
      'failed-precondition',
      'A sessão de reprodução é inválida ou expirou.'
    );
  }

  const sessionRef = db.collection(PLAYBACK_SESSIONS_COLLECTION).doc(tokenHash);
  const now = Date.now();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(sessionRef);
    const session = snapshot.exists
      ? snapshot.data() as VideoPlaybackSessionDocument
      : null;
    const decision = evaluateVideoPlaybackSession({
      session,
      viewerUid: params.viewerUid,
      ownerUid: params.ownerUid,
      videoId: params.videoId,
      appId: params.appId,
      now,
    });

    if (!decision.allowed) {
      throw new HttpsError(
        'failed-precondition',
        'A sessão de reprodução é inválida ou expirou.',
        { reason: decision.reason }
      );
    }

    transaction.update(sessionRef, {
      consumedAt: now,
      consumedByAppId: params.appId,
    });
  });
}

export const recordVideoView = onCall(
  MEDIA_VIEW_CALLABLE_OPTIONS,
  async (request) => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (request.app?.alreadyConsumed === true) {
      throw new HttpsError(
        'permission-denied',
        'A validação de integridade desta solicitação já foi utilizada.'
      );
    }

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    await assertInteractionAccess(viewerUid);

    if (viewerUid !== ownerUid) {
      await consumePlaybackSession({
        playbackSessionToken: request.data?.playbackSessionToken,
        viewerUid,
        ownerUid,
        videoId,
        appId: cleanId(request.app?.appId) || null,
      });
    }

    return recordVideoViewCore.run(request as any);
  }
);
