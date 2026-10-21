import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  assertNoActiveBilateralBlock,
  assertNoActiveBilateralBlockInTransaction,
} from '../../friendship/application/bilateral-block-access.policy';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import {
  assertPublicMediaConsumptionAccess,
  assertPublicMediaConsumptionAccessInTransaction,
} from './public-media-consumption-access.policy';
import { assertCurrentPublicMediaOwnerLifecycle } from './public-media-transaction-owner-access.policy';
import { resolvePublicMediaOwnerExposure } from './public-media-owner-exposure.service';
import {
  consumePublicVideoPlaybackSessionStartQuota,
} from './public-video-playback-session-rate-limit.service';
import {
  PUBLIC_VIDEO_PLAYBACK_SESSION_COLLECTION,
  PUBLIC_VIDEO_PLAYBACK_SESSION_SCHEMA_VERSION,
  PUBLIC_VIDEO_PLAYBACK_SESSION_TTL_MS,
  createPublicVideoPlaybackToken,
  hashPublicVideoPlaybackToken,
} from './public-video-playback-session';
import { calculateRequiredVideoPlaybackMs } from './video-view-qualification';
import {
  assertCurrentPublicVideoTransactionExposure,
} from './public-video-transaction-exposure.policy';

interface StartPublicVideoPlaybackSessionRequest {
  ownerUid?: string;
  videoId?: string;
}

interface StartPublicVideoPlaybackSessionResponse {
  ownerUid: string;
  videoId: string;
  playbackToken: string;
  issuedAt: number;
  earliestQualifiedAt: number;
  expiresAt: number;
  requiredPlaybackMs: number;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  return normalized &&
    normalized.length <= 128 &&
    !normalized.includes('/')
    ? normalized
    : '';
}

function safePositiveInteger(value: unknown): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : 0;
}

export const startPublicVideoPlaybackSession = onCall<
  StartPublicVideoPlaybackSessionRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request): Promise<StartPublicVideoPlaybackSessionResponse> => {
    const viewerUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    assertPublicMediaCallableAppCheck(request.app);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    if (viewerUid === ownerUid) {
      throw new HttpsError(
        'failed-precondition',
        'Visualizações do próprio vídeo não são contabilizadas.'
      );
    }

    /**
     * A quota é consumida antes das leituras de elegibilidade/perfil/vídeo.
     * Assim um cliente autenticado que automatize o callable deixa de provocar
     * múltiplas leituras caras após atingir o limite. App Check é a primeira
     * barreira fora dos ambientes explicitamente isentos; o Functions Emulator
     * permanece livre dele para testes locais determinísticos.
     */
    await consumePublicVideoPlaybackSessionStartQuota(viewerUid);
    await assertPublicMediaConsumptionAccess(viewerUid);
    await assertNoActiveBilateralBlock(
      viewerUid,
      ownerUid,
      'Vídeo público não encontrado.'
    );

    const nowMs = Date.now();
    const ownerExposureByUid = await resolvePublicMediaOwnerExposure(
      [ownerUid],
      new Set<string>(),
      nowMs
    );

    if (ownerExposureByUid.get(ownerUid)?.allowed !== true) {
      throw new HttpsError('not-found', 'Vídeo público não encontrado.');
    }

    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const publicVideoSnapshot = await publicVideoRef.get();

    if (!publicVideoSnapshot.exists) {
      throw new HttpsError('not-found', 'Vídeo público não encontrado.');
    }

    const publicVideo = publicVideoSnapshot.data() ?? {};

    if (
      publicVideo.visibility !== 'PUBLIC' ||
      publicVideo.moderationStatus !== 'APPROVED'
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Vídeo indisponível para visualização pública.'
      );
    }

    const durationMs = safePositiveInteger(publicVideo.durationMs);
    /**
     * Versão da mídia, não versão social do documento.
     * `updatedAt` muda com título, reação, comentário, ranking e retenção e não
     * pode invalidar uma sessão de reprodução já iniciada por outro usuário.
     * Vídeos legados usam `publishedAt` até receberem `assetVersion` em uma nova
     * publicação/substituição do ativo.
     */
    const videoVersion = safePositiveInteger(
      publicVideo.assetVersion ?? publicVideo.publishedAt
    );

    if (!durationMs || !videoVersion) {
      throw new HttpsError(
        'failed-precondition',
        'O vídeo não possui metadados válidos para reprodução.'
      );
    }

    const issuedAt = Date.now();
    const requiredPlaybackMs = calculateRequiredVideoPlaybackMs(durationMs);
    const earliestQualifiedAt = issuedAt + requiredPlaybackMs;
    const expiresAt = issuedAt + PUBLIC_VIDEO_PLAYBACK_SESSION_TTL_MS;
    const playbackToken = createPublicVideoPlaybackToken();
    const tokenHash = hashPublicVideoPlaybackToken(playbackToken);
    const playbackSessionRef = publicVideoRef
      .collection(PUBLIC_VIDEO_PLAYBACK_SESSION_COLLECTION)
      .doc(viewerUid);

    // Canonical owner, viewer, bilateral blocks and asset must all be current
    // when the playback token is persisted, not only during preflight.
    const ownerAccountRef = db.doc(`users/${ownerUid}`);
    const ownerPublicProfileRef = db.doc(`public_profiles/${ownerUid}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    await db.runTransaction(async (transaction) => {
      await Promise.all([
        assertPublicMediaConsumptionAccessInTransaction(transaction, viewerUid),
        assertNoActiveBilateralBlockInTransaction(
          transaction, viewerUid, ownerUid, 'Vídeo público não encontrado.'
        ),
      ]);
      const [ownerAccountSnap, ownerPublicProfileSnap,
        currentVideoSnap, publicationSnap] = await Promise.all([
        transaction.get(ownerAccountRef),
        transaction.get(ownerPublicProfileRef),
        transaction.get(publicVideoRef),
        transaction.get(publicationRef),
      ]);
      assertCurrentPublicMediaOwnerLifecycle(ownerAccountSnap.data());
      if (!ownerPublicProfileSnap.exists) {
        throw new HttpsError('not-found', 'Vídeo público não encontrado.');
      }
      const currentVideo = currentVideoSnap.data() ?? {};
      const currentVersion = safePositiveInteger(
        currentVideo.assetVersion ?? currentVideo.publishedAt
      );
      if (!currentVideoSnap.exists ||
          currentVideo.visibility !== 'PUBLIC' ||
          currentVideo.moderationStatus !== 'APPROVED' ||
          currentVersion !== videoVersion) {
        throw new HttpsError('not-found', 'Vídeo público não encontrado.');
      }
      assertCurrentPublicVideoTransactionExposure({
        publicVideo: currentVideo,
        publication: publicationSnap.data(),
        nowMs: Date.now(),
      });
      transaction.set(playbackSessionRef, {
        schemaVersion: PUBLIC_VIDEO_PLAYBACK_SESSION_SCHEMA_VERSION,
        viewerUid,
        ownerUid,
        videoId,
        tokenHash,
        issuedAt,
        earliestQualifiedAt,
        expiresAt,
        requiredPlaybackMs,
        videoVersion,
        consumedAt: null,
      });
    }, { maxAttempts: 3 });

    return {
      ownerUid,
      videoId,
      playbackToken,
      issuedAt,
      earliestQualifiedAt,
      expiresAt,
      requiredPlaybackMs,
    };
  }
);
