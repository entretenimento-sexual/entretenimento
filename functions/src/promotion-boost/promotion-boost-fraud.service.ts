// functions/src/promotion-boost/promotion-boost-fraud.service.ts
import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';

import { db } from '../firebaseApp';
import {
  PROMOTION_BOOST_FRAUD_SIGNAL_TTL_MS,
  type PromotionBoostFraudSignalReason,
} from './promotion-boost-abuse.policy';

function viewerHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 40);
}

function signalDocumentId(input: {
  viewerUid: string;
  campaignId: string | null;
  placementId: string | null;
  reason: PromotionBoostFraudSignalReason;
  now: number;
}): string {
  const day = Math.floor(input.now / (24 * 60 * 60 * 1_000));
  return createHash('sha256')
    .update([
      viewerHash(input.viewerUid),
      input.campaignId ?? '-',
      input.placementId ?? '-',
      input.reason,
      day,
    ].join(':'))
    .digest('hex');
}

export async function recordPromotionBoostFraudSignal(input: {
  readonly viewerUid: string;
  readonly campaignId: string | null;
  readonly placementId: string | null;
  readonly reason: PromotionBoostFraudSignalReason;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly now?: number;
}): Promise<void> {
  const now = Math.trunc(input.now ?? Date.now());
  const signalId = signalDocumentId({
    viewerUid: input.viewerUid,
    campaignId: input.campaignId,
    placementId: input.placementId,
    reason: input.reason,
    now,
  });
  const signalRef = db.collection('promotion_boost_fraud_signals').doc(signalId);

  await signalRef.set({
    signalId,
    viewerHash: viewerHash(input.viewerUid),
    campaignId: input.campaignId,
    placementId: input.placementId,
    reason: input.reason,
    metadata: input.metadata ?? {},
    occurrences: FieldValue.increment(1),
    firstSeenAt: now,
    lastSeenAt: now,
    expiresAt: now + PROMOTION_BOOST_FRAUD_SIGNAL_TTL_MS,
  }, { merge: true });
}

export async function incrementPromotionBoostFraudCounter(input: {
  readonly viewerUid: string;
  readonly day: string;
  readonly reason: PromotionBoostFraudSignalReason;
  readonly now?: number;
}): Promise<void> {
  const now = Math.trunc(input.now ?? Date.now());
  const counterRef = db.collection('promotion_boost_fraud_counters').doc(
    `${viewerHash(input.viewerUid)}:${input.day}`
  );

  await counterRef.set({
    viewerHash: viewerHash(input.viewerUid),
    day: input.day,
    totalSignals: FieldValue.increment(1),
    reasonCounts: {
      [input.reason]: FieldValue.increment(1),
    },
    updatedAt: now,
    expiresAt: now + PROMOTION_BOOST_FRAUD_SIGNAL_TTL_MS,
  }, { merge: true });
}
