// functions/src/payments/application/get-my-billing-snapshot.handler.ts
// -----------------------------------------------------------------------------
// GET MY BILLING SNAPSHOT HANDLER
// -----------------------------------------------------------------------------
// Consulta consolidada do estado financeiro do usuário autenticado.
// O entitlement é a verdade; a projeção privada é reconciliada como efeito
// operacional seguro para UI e Firestore Rules.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  assertCallableAppCheck,
} from '../../shared/security/callable-app-check';
import type {
  PlatformRecurringSubscriptionDoc,
  PlatformRecurringSubscriptionStateDoc,
} from '../domain/platform-recurring-subscription.model';
import {
  PLATFORM_SUBSCRIPTION_COLLECTION,
  PLATFORM_SUBSCRIPTION_STATE_COLLECTION,
} from './platform-recurring-subscription.service';
import {
  assertRecurringContractBuyer,
} from './recurring-contract-authority.policy';
import { PlatformRole } from '../domain/billing.model';
import {
  PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
  reconcilePlatformSubscriptionAccess,
} from './platform-subscription-projection.service';

interface BillingSnapshotResponse {
  role?: PlatformRole | null;
  tier?: PlatformRole | null;
  isSubscriber: boolean;
  status: 'active' | 'inactive';
  entitlements: string[];
  startsAt?: number | null;
  endsAt?: number | null;
  updatedAt?: number | null;
  projectionVersion: number;
  recurringConfigured: boolean;
  renewalEnabled: boolean;
  renewalStatus: 'active' | 'cancel_pending' | 'canceled' | 'none';
  renewalCancellationPending: boolean;
}

export const getMyBillingSnapshot = onCall<Record<string, never>>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<BillingSnapshotResponse> => {
    const uid = request.auth?.uid ?? null;

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Usuário não autenticado.'
      );
    }

    assertCallableAppCheck(request.app);

    const [platformEntitlement, recurringStateSnapshot] = await Promise.all([
      reconcilePlatformSubscriptionAccess(uid),
      db
        .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
        .doc(uid)
        .get(),
    ]);
    const recurringState = recurringStateSnapshot.exists
      ? recurringStateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
      : null;
    if (
      recurringStateSnapshot.exists
      && recurringState?.buyerUid !== uid
    ) {
      throw new HttpsError(
        'data-loss',
        'O estado da assinatura recorrente está inconsistente.',
        { reason: 'recurring_state_buyer_mismatch' }
      );
    }

    const recurringContractSnapshot = recurringState?.currentContractId
      ? await db
        .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
        .doc(recurringState.currentContractId)
        .get()
      : null;

    if (
      recurringState?.currentContractId
      && !recurringContractSnapshot?.exists
    ) {
      throw new HttpsError(
        'data-loss',
        'O contrato recorrente atual não foi localizado.',
        { reason: 'recurring_contract_missing' }
      );
    }

    const recurringContract =
      recurringContractSnapshot?.exists
        ? recurringContractSnapshot.data() as PlatformRecurringSubscriptionDoc
        : null;

    if (recurringContract) {
      assertRecurringContractBuyer(recurringContract.buyerUid, uid);
    }

    const recurringConfigured = recurringContract !== null;
    const renewalEnabled =
      recurringConfigured
      && recurringState?.renewalEnabled === true;
    const renewalCancellationPending =
      recurringContract?.needsProviderCancellation === true;
    const renewalStatus:
      'active' | 'cancel_pending' | 'canceled' | 'none' =
      renewalEnabled
        ? 'active'
        : renewalCancellationPending
          ? 'cancel_pending'
          : recurringConfigured
            ? 'canceled'
            : 'none';

    if (!platformEntitlement.active || !platformEntitlement.role) {
      return {
        role: null,
        tier: null,
        isSubscriber: false,
        status: 'inactive',
        entitlements: [],
        startsAt: platformEntitlement.startsAt,
        endsAt: platformEntitlement.endsAt,
        updatedAt: platformEntitlement.updatedAt,
        projectionVersion: PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
        recurringConfigured,
        renewalEnabled,
        renewalStatus,
        renewalCancellationPending,
      };
    }

    return {
      role: platformEntitlement.role,
      tier: platformEntitlement.role,
      isSubscriber: true,
      status: 'active',
      entitlements: ['platform_subscription'],
      startsAt: platformEntitlement.startsAt,
      endsAt: platformEntitlement.endsAt,
      updatedAt: platformEntitlement.updatedAt,
      projectionVersion: PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
      recurringConfigured,
      renewalEnabled,
      renewalStatus,
      renewalCancellationPending,
    };
  }
);
