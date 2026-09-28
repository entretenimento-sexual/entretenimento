// functions/src/community-boost/record-community-boost-event.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST QUALIFIED EVENTS
// -----------------------------------------------------------------------------
// Eventos do navegador são telemetria agregada, nunca autoridade financeira.
// O faturamento acontece exclusivamente na concessão server-side do placement.
// Qualified exposure e clique servem para medir qualidade da entrega.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';
import {
  PROMOTION_BOOST_EVENT_RATE_LIMIT,
  isPromotionBoostEventTimingPlausible,
  isPromotionBoostSelfInteraction,
} from '../promotion-boost/promotion-boost-abuse.policy';
import {
  incrementPromotionBoostFraudCounter,
  recordPromotionBoostFraudSignal,
} from '../promotion-boost/promotion-boost-fraud.service';
import { assertCommunitySocialAccessForUid } from '../community/community-social-access.service';
import {
  normalizeCommunityBoostCampaign,
  resolveCommunityBoostDay,
} from './community-boost.policy';

type CommunityBoostEventType = 'qualified_exposure' | 'click';

interface RecordCommunityBoostEventRequest {
  readonly placementId?: unknown;
  readonly event?: unknown;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function hashViewer(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 40);
}

function normalizeEvent(value: unknown): CommunityBoostEventType | null {
  return value === 'qualified_exposure' || value === 'click'
    ? value
    : null;
}

export const recordCommunityBoostEvent =
  onCall<RecordCommunityBoostEventRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
    },
    async (request) => {
      assertCallableAppCheck(request.app);
      const uid = String(request.auth?.uid ?? '').trim();
      if (!uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }
      if (request.auth?.token?.['email_verified'] !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Verifique seu e-mail para continuar.'
        );
      }

      const placementId = cleanId(request.data?.placementId);
      const event = normalizeEvent(request.data?.event);
      if (!placementId || !event) {
        throw new HttpsError(
          'invalid-argument',
          'Evento de Community Boost inválido.'
        );
      }

      await assertCommunitySocialAccessForUid(uid);
      try {
        await consumeBackendRateLimitQuota({
          action: 'community_boost_event',
          subject: uid,
          config: PROMOTION_BOOST_EVENT_RATE_LIMIT,
          message: 'Muitos eventos patrocinados foram recebidos em pouco tempo.',
        });
      } catch (error) {
        if (
          error instanceof HttpsError
          && error.code === 'resource-exhausted'
        ) {
          const fraudNow = Date.now();
          await Promise.allSettled([
            recordPromotionBoostFraudSignal({
              viewerUid: uid,
              campaignId: null,
              placementId,
              reason: 'event_velocity_exceeded',
              now: fraudNow,
            }),
            incrementPromotionBoostFraudCounter({
              viewerUid: uid,
              day: resolveCommunityBoostDay(fraudNow),
              reason: 'event_velocity_exceeded',
              now: fraudNow,
            }),
          ]);
        }
        throw error;
      }

      const placementRef = db
        .collection('community_boost_placements')
        .doc(placementId);
      const now = Date.now();

      const result = await db.runTransaction(async (transaction) => {
        const placementSnapshot = await transaction.get(placementRef);
        if (!placementSnapshot.exists) {
          throw new HttpsError('not-found', 'Placement patrocinado expirado.');
        }

        const placement = placementSnapshot.data() ?? {};
        const campaignId = cleanId(placement['campaignId']);
        const communityId = cleanId(placement['communityId']);
        const advertiserUid = cleanId(placement['advertiserUid']);
        const targetOwnerUid = cleanId(placement['targetOwnerUid']);
        const deliveredAt = Math.trunc(Number(placement['deliveredAt']));
        const expectedViewerHash = hashViewer(uid);

        if (
          !campaignId
          || !communityId
          || !advertiserUid
          || !targetOwnerUid
          || placement['viewerHash'] !== expectedViewerHash
          || placement['status'] !== 'delivered'
          || !Number.isFinite(Number(placement['expiresAt']))
          || Number(placement['expiresAt']) < now
        ) {
          return {
            accepted: false,
            idempotent: false,
            billable: false,
            fraudReason: 'placement_identity_mismatch' as const,
            campaignId,
            fraudMetadata: {},
          };
        }

        if (
          isPromotionBoostSelfInteraction({
            viewerUid: uid,
            advertiserUid,
            targetOwnerUid,
          })
        ) {
          return {
            accepted: false,
            idempotent: false,
            billable: false,
            fraudReason: 'self_interaction' as const,
            campaignId,
            fraudMetadata: {},
          };
        }

        if (
          !isPromotionBoostEventTimingPlausible({
            event,
            deliveredAt,
            now,
          })
        ) {
          return {
            accepted: false,
            idempotent: false,
            billable: false,
            fraudReason: 'event_too_fast' as const,
            campaignId,
            fraudMetadata: {
              event,
              elapsedMs: now - deliveredAt,
            },
          };
        }

        const alreadyRecorded = event === 'qualified_exposure'
          ? placement['qualifiedExposureRecordedAt'] !== null
            && placement['qualifiedExposureRecordedAt'] !== undefined
          : placement['clickRecordedAt'] !== null
            && placement['clickRecordedAt'] !== undefined;

        if (alreadyRecorded) {
          return {
            accepted: true,
            idempotent: true,
            billable: Number(placement['billedMilliCents']) > 0,
          };
        }

        const campaignRef = db
          .collection('community_boost_campaigns')
          .doc(campaignId);
        const campaignSnapshot = await transaction.get(campaignRef);
        const campaign = campaignSnapshot.exists
          ? normalizeCommunityBoostCampaign(campaignSnapshot.data())
          : null;

        if (!campaign || campaign.communityId !== communityId) {
          throw new HttpsError(
            'data-loss',
            'Campanha patrocinada inconsistente.'
          );
        }

        const day = resolveCommunityBoostDay(now);
        const metricsRef = campaignRef.collection('metrics_daily').doc(day);

        if (event === 'click') {
          transaction.update(placementRef, {
            clickRecordedAt: now,
            updatedAt: now,
          });
          transaction.update(campaignRef, {
            clickCount: FieldValue.increment(1),
            updatedAt: now,
          });
          transaction.set(metricsRef, {
            day,
            deliveredCount: FieldValue.increment(0),
            qualifiedExposureCount: FieldValue.increment(0),
            clickCount: FieldValue.increment(1),
            billedMilliCents: FieldValue.increment(0),
            updatedAt: now,
          }, { merge: true });

          return {
            accepted: true,
            idempotent: false,
            billable: false,
          };
        }

        transaction.update(placementRef, {
          qualifiedExposureRecordedAt: now,
          updatedAt: now,
        });

        transaction.update(campaignRef, {
          qualifiedExposureCount: FieldValue.increment(1),
          updatedAt: now,
        });

        transaction.set(metricsRef, {
          day,
          deliveredCount: FieldValue.increment(0),
          qualifiedExposureCount: FieldValue.increment(1),
          clickCount: FieldValue.increment(0),
          billedMilliCents: FieldValue.increment(0),
          updatedAt: now,
        }, { merge: true });

        return {
          accepted: true,
          idempotent: false,
          billable: Number(placement['billedMilliCents']) > 0,
        };
      });

      if ('fraudReason' in result && result.fraudReason) {
        await Promise.allSettled([
          recordPromotionBoostFraudSignal({
            viewerUid: uid,
            campaignId: result.campaignId,
            placementId,
            reason: result.fraudReason,
            metadata: result.fraudMetadata,
            now,
          }),
          incrementPromotionBoostFraudCounter({
            viewerUid: uid,
            day: resolveCommunityBoostDay(now),
            reason: result.fraudReason,
            now,
          }),
        ]);

        throw new HttpsError(
          result.fraudReason === 'self_interaction'
            ? 'permission-denied'
            : 'failed-precondition',
          result.fraudReason === 'self_interaction'
            ? 'Auto-interação patrocinada não é contabilizada.'
            : 'Evento patrocinado não qualificado.'
        );
      }

      return result;
    }
  );
