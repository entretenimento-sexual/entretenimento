// functions/src/community/record-community-discovery-exposure.handler.ts
import { randomInt } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  estimateExposureWritesPerAcceptedExposure,
  evaluateOperationalCostBudget,
} from '../shared/observability/operational-cost-budget.policy';
import { consumeBackendRateLimitQuota } from '../shared/security/backend-rate-limit.service';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  normalizeCommunityDistributionTelemetryRequest,
  type CommunityDistributionTelemetryEvent,
  type CommunityDistributionTelemetryRequest,
} from './community-distribution-telemetry.policy';
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

      const accepted = eligibleCommunityIds.length;
      const rateLimitWrites = 1;
      const operationalWritesProxy = accepted + rateLimitWrites;
      const writesPerAcceptedExposure =
        estimateExposureWritesPerAcceptedExposure({
          accepted,
          successfulRateLimitWrites: rateLimitWrites,
        });
      const operationalCostBudget =
        writesPerAcceptedExposure === null
          ? null
          : evaluateOperationalCostBudget(
            'community.discovery.exposure_writes_per_accepted',
            writesPerAcceptedExposure
          );

      logger.info('community_discovery_exposure_recorded', {
        sourceType: command.sourceType,
        submitted: command.communityIds.length,
        accepted,
        projectionReads: projectionSnapshots.length,
        counterWrites: accepted,
        rateLimitWrites,
        operationalWritesProxy,
        writesPerAcceptedExposure,
        operationalCostBudget,
        writeBatchCommitted: accepted > 0,
        durationMs: Date.now() - startedAt,
      });

      return {
        accepted: eligibleCommunityIds.length,
        generatedAt: now,
      };
    }
  );

export const recordCommunityDistributionEvents =
  onCall<CommunityDistributionTelemetryRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityDiscoveryExposureResponse> => {
      const startedAt = Date.now();
      assertRuntime();
      assertCommunityCallableAppCheck(request.app);
      const uid = assertActor(request.auth);
      const command = normalizeCommunityDistributionTelemetryRequest(
        request.data
      );

      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'Lote de telemetria de distribuição de Comunidades inválido.'
        );
      }

      await assertCommunitySocialAccessForUid(uid);
      await consumeExposureQuota(uid);

      const communityIds = [...new Set(
        command.events.map((event) => event.communityId)
      )];
      const projectionSnapshots = await db.getAll(
        ...communityIds.map((communityId) =>
          db.collection('community_discovery_index').doc(communityId)
        )
      );
      const eligibleCommunityIds = new Set(
        projectionSnapshots
          .filter((snapshot) =>
            snapshot.exists
            && isCommunityDiscoveryExposureEligibleProjection(
              snapshot.data(),
              'community'
            )
          )
          .map((snapshot) => snapshot.id)
      );
      const eligibleEvents = command.events.filter((event) =>
        eligibleCommunityIds.has(event.communityId)
      );
      const now = Date.now();
      let counterWrites = 0;

      if (eligibleEvents.length > 0) {
        const day = resolveCommunityDiscoveryExposureDay(now);
        const dayRef = db
          .collection('community_discovery_exposure_daily')
          .doc(day);
        const eventsByCommunity = new Map<
          string,
          CommunityDistributionTelemetryEvent[]
        >();

        for (const event of eligibleEvents) {
          const current = eventsByCommunity.get(event.communityId) ?? [];
          current.push(event);
          eventsByCommunity.set(event.communityId, current);
        }

        const batch = db.batch();

        for (const [communityId, events] of eventsByCommunity) {
          const shard = randomInt(COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS);
          const shardRef = dayRef
            .collection('communities')
            .doc(communityId)
            .collection('shards')
            .doc(String(shard));
          const distribution: Record<string, Record<string, unknown>> = {};
          let qualifiedExposureCount = 0;

          for (const event of events) {
            const eventMetrics = distribution[event.eventType] ?? {};
            eventMetrics[event.surface] = FieldValue.increment(1);
            distribution[event.eventType] = eventMetrics;

            if (event.eventType === 'qualified_exposure') {
              qualifiedExposureCount += 1;
            }
          }

          const payload: Record<string, unknown> = {
            sourceType: 'community',
            distribution,
            updatedAt: now,
          };

          // Preserva o contador legado de exposições totais. Aberturas não
          // alteram esse total e vivem somente na dimensão distribution.open.
          if (qualifiedExposureCount > 0) {
            payload['count'] = FieldValue.increment(qualifiedExposureCount);
          }

          batch.set(shardRef, payload, { merge: true });
          counterWrites += 1;
        }

        await batch.commit();
      }

      const accepted = eligibleEvents.length;
      const rateLimitWrites = 1;
      const operationalWritesProxy = counterWrites + rateLimitWrites;
      const writesPerAcceptedEvent = accepted > 0
        ? Math.round((operationalWritesProxy / accepted) * 100) / 100
        : null;

      logger.info('community_distribution_events_recorded', {
        submitted: command.events.length,
        accepted,
        uniqueCommunities: communityIds.length,
        projectionReads: projectionSnapshots.length,
        counterWrites,
        rateLimitWrites,
        operationalWritesProxy,
        writesPerAcceptedEvent,
        durationMs: Date.now() - startedAt,
      });

      return {
        accepted,
        generatedAt: now,
      };
    }
  );
