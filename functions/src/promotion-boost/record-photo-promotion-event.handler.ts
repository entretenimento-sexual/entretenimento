// functions/src/promotion-boost/record-photo-promotion-event.handler.ts
import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { REQUIRE_CALLABLE_APP_CHECK, assertCallableAppCheck } from '../shared/security/callable-app-check';
import { consumeBackendRateLimitQuota } from '../shared/security/backend-rate-limit.service';
import {
  PROMOTION_BOOST_EVENT_RATE_LIMIT,
  PROMOTION_BOOST_FRAUD_SIGNAL_TTL_MS,
  isPromotionBoostEventTimingPlausible,
  isPromotionBoostSelfInteraction,
} from './promotion-boost-abuse.policy';
import { normalizePromotionBoostCampaign, resolvePromotionBoostDay } from './promotion-boost.policy';

type EventType = 'qualified_exposure' | 'click';

interface Request {
  readonly placementId?: unknown;
  readonly event?: unknown;
}

const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const v = String(value ?? '').trim();
  return SAFE_ID.test(v) ? v : null;
}

function viewerHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 40);
}

export const recordPhotoPromotionEvent = onCall<Request>(
  { region: FUNCTIONS_REGION, enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK },
  async (request) => {
    assertCallableAppCheck(request.app);
    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');

    const placementId = cleanId(request.data?.placementId);
    const event: EventType | null =
      request.data?.event === 'qualified_exposure' || request.data?.event === 'click'
        ? request.data.event
        : null;
    if (!placementId || !event) {
      throw new HttpsError('invalid-argument', 'Evento de Promotion/Boost inválido.');
    }

    try {
      await consumeBackendRateLimitQuota({
        action: 'photo_promotion_event',
        subject: uid,
        config: PROMOTION_BOOST_EVENT_RATE_LIMIT,
        message: 'Muitos eventos patrocinados foram recebidos em pouco tempo.',
      });
    } catch (error) {
      const fraudNow = Date.now();
      const day = resolvePromotionBoostDay(fraudNow);
      const hash = viewerHash(uid);
      await Promise.allSettled([
        db.collection('promotion_boost_fraud_signals').add({
          viewerHash: hash,
          campaignId: null,
          placementId,
          reason: 'event_velocity_exceeded',
          createdAt: fraudNow,
          expiresAt: fraudNow + PROMOTION_BOOST_FRAUD_SIGNAL_TTL_MS,
        }),
        db.collection('promotion_boost_fraud_counters')
          .doc(`${hash}:${day}`)
          .set({
            viewerHash: hash,
            day,
            totalSignals: FieldValue.increment(1),
            'reasonCounts.event_velocity_exceeded': FieldValue.increment(1),
            updatedAt: fraudNow,
            expiresAt: fraudNow + PROMOTION_BOOST_FRAUD_SIGNAL_TTL_MS,
          }, { merge: true }),
      ]);
      throw error;
    }

    const placementRef = db.collection('promotion_boost_placements').doc(placementId);
    const now = Date.now();

    return db.runTransaction(async (transaction) => {
      const fraudSignalRef = db.collection('promotion_boost_fraud_signals').doc();
      const fraudCounterRef = db.collection('promotion_boost_fraud_counters').doc(
        `${viewerHash(uid)}:${resolvePromotionBoostDay(now)}`
      );
      const writeFraudSignal = (
        reason:
          | 'self_interaction'
          | 'event_too_fast'
          | 'placement_identity_mismatch',
        campaignId: string | null,
        metadata: Readonly<Record<string, unknown>> = {}
      ) => {
        transaction.create(fraudSignalRef, {
          signalId: fraudSignalRef.id,
          viewerHash: viewerHash(uid),
          campaignId,
          placementId,
          reason,
          metadata,
          createdAt: now,
          expiresAt: now + PROMOTION_BOOST_FRAUD_SIGNAL_TTL_MS,
        });
        transaction.set(fraudCounterRef, {
          viewerHash: viewerHash(uid),
          day: resolvePromotionBoostDay(now),
          totalSignals: FieldValue.increment(1),
          [`reasonCounts.${reason}`]: FieldValue.increment(1),
          updatedAt: now,
          expiresAt: now + PROMOTION_BOOST_FRAUD_SIGNAL_TTL_MS,
        }, { merge: true });
      };

      const placementSnapshot = await transaction.get(placementRef);
      if (!placementSnapshot.exists) {
        throw new HttpsError('not-found', 'Placement patrocinado expirado.');
      }

      const placement = placementSnapshot.data() ?? {};
      const campaignId = cleanId(placement['campaignId']);
      const advertiserUid = cleanId(placement['advertiserUid']);
      const targetOwnerUid = cleanId(placement['ownerUid']);
      const deliveredAt = Math.trunc(Number(placement['deliveredAt']));

      if (
        !campaignId
        || !advertiserUid
        || !targetOwnerUid
        || placement['targetType'] !== 'photo'
        || placement['viewerHash'] !== viewerHash(uid)
        || placement['status'] !== 'delivered'
        || Number(placement['expiresAt']) < now
      ) {
        writeFraudSignal(
          'placement_identity_mismatch',
          campaignId
        );
        throw new HttpsError('permission-denied', 'Placement patrocinado indisponível.');
      }

      if (
        isPromotionBoostSelfInteraction({
          viewerUid: uid,
          advertiserUid,
          targetOwnerUid,
        })
      ) {
        writeFraudSignal(
          'self_interaction',
          campaignId
        );
        throw new HttpsError(
          'permission-denied',
          'Auto-interação patrocinada não é contabilizada.'
        );
      }

      if (
        !isPromotionBoostEventTimingPlausible({
          event,
          deliveredAt,
          now,
        })
      ) {
        writeFraudSignal(
          'event_too_fast',
          campaignId,
          {
            event,
            elapsedMs: now - deliveredAt,
          }
        );
        throw new HttpsError(
          'failed-precondition',
          'Evento patrocinado não qualificado.'
        );
      }

      const field =
        event === 'click' ? 'clickRecordedAt' : 'qualifiedExposureRecordedAt';
      if (placement[field] !== null && placement[field] !== undefined) {
        return {
          accepted: true,
          idempotent: true,
          billable: Number(placement['billedMilliCents']) > 0,
        };
      }

      const campaignRef = db.collection('promotion_boost_campaigns').doc(campaignId);
      const campaignSnapshot = await transaction.get(campaignRef);
      const campaign = campaignSnapshot.exists
        ? normalizePromotionBoostCampaign(campaignSnapshot.data())
        : null;
      if (!campaign || campaign.targetType !== 'photo') {
        throw new HttpsError('data-loss', 'Campanha promocional inconsistente.');
      }

      const day = resolvePromotionBoostDay(now);
      const metricsRef = campaignRef.collection('metrics_daily').doc(day);

      transaction.update(placementRef, { [field]: now, updatedAt: now });
      transaction.update(campaignRef, {
        ...(event === 'click'
          ? { clickCount: FieldValue.increment(1) }
          : { qualifiedExposureCount: FieldValue.increment(1) }),
        updatedAt: now,
      });
      transaction.set(metricsRef, {
        day,
        deliveredCount: FieldValue.increment(0),
        qualifiedExposureCount: FieldValue.increment(event === 'qualified_exposure' ? 1 : 0),
        clickCount: FieldValue.increment(event === 'click' ? 1 : 0),
        billedMilliCents: FieldValue.increment(0),
        updatedAt: now,
      }, { merge: true });

      return {
        accepted: true,
        idempotent: false,
        billable: Number(placement['billedMilliCents']) > 0,
      };
    });
  }
);
