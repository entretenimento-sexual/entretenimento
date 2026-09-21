// functions/src/business-official/business-official-entitlement.service.ts
// -----------------------------------------------------------------------------
// BUSINESS / OFFICIAL ENTITLEMENT SERVICE
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';

import { db } from '../firebaseApp';
import {
  buildBusinessOfficialEntitlementId,
  evaluateBusinessOfficialEntitlement,
  type BusinessOfficialEntitlementDecision,
  type BusinessOfficialEntitlementSubjectType,
} from './business-official-entitlement.policy';

export interface ResolvedBusinessOfficialEntitlement
  extends BusinessOfficialEntitlementDecision {
  readonly entitlementId: string | null;
}

export async function resolveBusinessOfficialEntitlementInTransaction(input: {
  readonly transaction: Transaction;
  readonly subjectType: BusinessOfficialEntitlementSubjectType;
  readonly subjectId: string;
  readonly now: number;
}): Promise<Readonly<ResolvedBusinessOfficialEntitlement>> {
  const entitlementId = buildBusinessOfficialEntitlementId(input);
  if (!entitlementId) {
    return Object.freeze({
      allowed: false,
      subjectType: input.subjectType,
      subjectId: null,
      capabilities: null,
      policyVersion: null,
      denialReason: 'entitlement_mismatch',
      entitlementId: null,
    });
  }

  const snapshot = await input.transaction.get(
    db.collection('entitlements').doc(entitlementId)
  );
  const decision = evaluateBusinessOfficialEntitlement({
    expectedSubjectType: input.subjectType,
    expectedSubjectId: input.subjectId,
    rawEntitlement: snapshot.exists ? snapshot.data() : null,
    now: input.now,
  });

  return Object.freeze({
    ...decision,
    entitlementId,
  });
}
