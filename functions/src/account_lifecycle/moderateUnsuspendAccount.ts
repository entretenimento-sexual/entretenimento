// functions/src/account_lifecycle/moderateUnsuspendAccount.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertAccountLifecycleMutationSecurity,
} from './account-lifecycle-mutation-security';
import {
  getAccountLifecycleSubscriptionRenewalStatus,
} from './account-lifecycle-billing.service';
import {
  ACCOUNT_LIFECYCLE_REGION,
  assertRecentAuthentication,
  assertStaffAuthorization,
} from './_shared';
import {
  restoreModerationSuspension,
} from './account-moderation-unsuspension.service';

interface ModerateUnsuspendAccountRequest {
  targetUid: string;
}

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus: 'active';
  publicVisibility: 'visible' | 'hidden';
  interactionBlocked: boolean;
  subscriptionRenewalStatus: 'active' | 'canceled' | 'pending' | 'none';
  message: string;
}

function normalizeUid(uid: string): string {
  return String(uid ?? '').trim();
}

export const moderateUnsuspendAccount = onCall<ModerateUnsuspendAccountRequest>(
  { region: ACCOUNT_LIFECYCLE_REGION },
  async (request): Promise<AccountLifecycleCommandResult> => {
    const actorUid = request.auth?.uid ?? null;
    const authToken = (request.auth?.token ?? {}) as Record<string, unknown>;

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Moderador não autenticado.');
    }

    assertRecentAuthentication(authToken);
    await assertStaffAuthorization({
      actorUid,
      authToken,
      requiredPermission: 'users:suspend',
    });

    await assertAccountLifecycleMutationSecurity({
      action: 'moderation_unsuspend',
      subjectUid: actorUid,
      appContext: request.app,
    });

    const targetUid = normalizeUid(request.data?.targetUid);
    const now = Date.now();

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'UID alvo inválido.');
    }

    if (targetUid === actorUid) {
      throw new HttpsError(
        'failed-precondition',
        'A moderação não pode alterar o próprio lifecycle por este fluxo.'
      );
    }

    const restored = await restoreModerationSuspension({
      targetUid,
      actorUid,
      source: 'moderator',
      now,
    });
    const subscriptionRenewalStatus =
      await getAccountLifecycleSubscriptionRenewalStatus(targetUid);

    return {
      ok: true,
      accountStatus: 'active',
      publicVisibility: restored.publicVisibility,
      interactionBlocked: restored.interactionBlocked,
      subscriptionRenewalStatus,
      message:
        subscriptionRenewalStatus === 'pending'
          ? 'Conta reativada pela moderação. A interrupção da renovação ainda está sendo processada.'
          : subscriptionRenewalStatus === 'canceled'
            ? 'Conta reativada pela moderação. A renovação automática permanece cancelada.'
            : restored.publicVisibility === 'visible'
              ? 'Conta reativada pela moderação.'
              : 'Conta reativada, mas permanece privada até concluir as verificações pendentes.',
    };
  }
);
