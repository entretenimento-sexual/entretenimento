// functions/src/account_lifecycle/account-lifecycle-mutation-security.ts
// -----------------------------------------------------------------------------
// ACCOUNT LIFECYCLE MUTATION SECURITY
// -----------------------------------------------------------------------------
// Fronteira transversal dos comandos que alteram o estado de uma conta.
// Auth/recent-auth/authorization continuam no handler; esta camada acrescenta
// App Check e rate limit backend de forma canônica.
// -----------------------------------------------------------------------------

import {
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';

export type AccountLifecycleMutationAction =
  | 'self_suspend'
  | 'self_reactivate'
  | 'self_delete'
  | 'self_cancel_deletion'
  | 'moderation_suspend'
  | 'moderation_unsuspend'
  | 'moderation_schedule_deletion';

interface AccountLifecycleMutationSecurityInput {
  action: AccountLifecycleMutationAction;
  subjectUid: string;
  appContext: unknown;
}

const SELF_SERVICE_ACTIONS =
  new Set<AccountLifecycleMutationAction>([
    'self_suspend',
    'self_reactivate',
    'self_delete',
    'self_cancel_deletion',
  ]);

export async function assertAccountLifecycleMutationSecurity(
  input: AccountLifecycleMutationSecurityInput
): Promise<void> {
  const subjectUid = String(input.subjectUid ?? '').trim();

  if (!subjectUid) {
    throw new Error(
      'Lifecycle mutation security requer subjectUid autenticado.'
    );
  }

  assertCallableAppCheck(input.appContext);

  const selfService = SELF_SERVICE_ACTIONS.has(input.action);

  await consumeBackendRateLimitQuota({
    action: `account-lifecycle:${input.action}`,
    subject: subjectUid,
    config: selfService
      ? {
        burstWindowMs: 60 * 60 * 1_000,
        burstMax: 8,
        sustainedWindowMs: 24 * 60 * 60 * 1_000,
        sustainedMax: 24,
      }
      : {
        burstWindowMs: 10 * 60 * 1_000,
        burstMax: 30,
        sustainedWindowMs: 24 * 60 * 60 * 1_000,
        sustainedMax: 300,
      },
    message: selfService
      ? 'Muitas alterações de estado da conta foram solicitadas. Tente novamente mais tarde.'
      : 'Muitas ações administrativas de lifecycle foram solicitadas. Tente novamente mais tarde.',
  });
}
