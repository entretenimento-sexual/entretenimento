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

    const platformEntitlement =
      await reconcilePlatformSubscriptionAccess(uid);

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
    };
  }
);
