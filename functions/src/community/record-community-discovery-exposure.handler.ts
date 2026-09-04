// functions/src/community/record-community-discovery-exposure.handler.ts
import { randomInt } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { consumeBackendRateLimitQuota } from '../shared/security/backend-rate-limit.service';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  COMMUNITY_DISCOVERY_EXPOSURE_BURST_MAX_BATCHES,
  COMMUNITY_DISCOVERY_EXPOSURE_BURST_WINDOW_MS,
  COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS,
  COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_MAX_BATCHES,
  COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_WINDOW_MS,
  isCommunityDiscoveryExposureEligibleProjection,
  normalizeCommunityDiscoveryExposureRequest,
  resolveCommunityDiscoveryExposureDay,
  type CommunityDiscoveryExposureRequest,
} from './community-discovery-exposure.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import { assertCommunitySocialAccessForUid } from './community-social-access.service';

interface CommunityDiscoveryExposureResponse {
  accepted: number;
  generatedAt: number;
}

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A telemetria de descoberta não está disponível neste ambiente.'
  );
}

function assertActor(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
  }
  return uid;
}

async function consumeExposureQuota(uid: string): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'community_discovery_exposure',
    subject: uid,
    config: {
      burstWindowMs: COMMUNITY_DISCOVERY_EXPOSURE_BURST_WINDOW_MS,
      burstMax: COMMUNITY_DISCOVERY_EXPOSURE_BURST_MAX_BATCHES,
      sustainedWindowMs: COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_WINDOW_MS,
      sustainedMax: COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_MAX_BATCHES,
    },
    message: 'Muitas atualizações de descoberta foram recebidas em pouco tempo.',
  });
}

export const recordCommunityDiscoveryExposure =
  onCall<CommunityDiscoveryExposureRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityDiscoveryExposureResponse> => {
      const startedAt = Date.now();
      assertRuntime();
      assertCommunityCallableAppCheck(request.app);
      const uid = assertActor(request.auth);
      const command = normalizeCommunityDiscoveryExposureRequest(request.data);

      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'Lote de visibilidade de Comunidades inválido.'
        );
      }

      await assertCommunitySocialAccessForUid(uid);
      await consumeExposureQuota(uid);

      const projectionRefs = command.communityIds.map((communityId) =>
        db.collection('community_discovery_index').doc(communityId)
      );
      const projectionSnapshots = await db.getAll(...projectionRefs);
      const eligibleCommunityIds = projectionSnapshots
        .filter((snapshot) =>
          snapshot.exists
          && isCommunityDiscoveryExposureEligibleProjection(
            snapshot.data(),
            command.sourceType
          )
        )
        .map((snapshot) => snapshot.id);
      const now = Date.now();

      if (eligibleCommunityIds.length > 0) {
        const day = resolveCommunityDiscoveryExposureDay(now);
        const batch = db.batch();
        const dayRef = db.collection('community_discovery_exposure_daily').doc(day);

        for (const communityId of eligibleCommunityIds) {
          const shard = randomInt(COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS);
          const shardRef = dayRef
            .collection('communities')
            .doc(communityId)
            .collection('shards')
            .doc(String(shard));

          batch.set(
            shardRef,
            {
              count: FieldValue.increment(1),
              sourceType: command.sourceType,
              updatedAt: now,
            },
            { merge: true }
          );
        }

        await batch.commit();
      }

      logger.debug('community_discovery_exposure_recorded', {
        sourceType: command.sourceType,
        submitted: command.communityIds.length,
        accepted: eligibleCommunityIds.length,
        projectionReads: projectionSnapshots.length,
        counterWrites: eligibleCommunityIds.length,
        writeBatchCommitted: eligibleCommunityIds.length > 0,
        durationMs: Date.now() - startedAt,
      });

      return {
        accepted: eligibleCommunityIds.length,
        generatedAt: now,
      };
    }
  );
