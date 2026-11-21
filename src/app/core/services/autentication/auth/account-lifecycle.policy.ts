// src/app/core/services/autentication/auth/account-lifecycle.policy.ts
// Política canônica de lifecycle da conta no runtime Angular.
//
// Objetivos:
// - impedir interpretações divergentes entre guards, orchestrator e stores;
// - tratar perfil autenticado ainda não hidratado como estado desconhecido;
// - falhar fechado quando UID/perfil divergem ou chega um status inesperado;
// - manter guest resolvido fora do conceito de bloqueio de conta.

import type { AccountStatus, IUserDados } from '@core/interfaces/iuser-dados';

export type RuntimeAccountLifecycleStatus =
  | AccountStatus
  | 'registration_pending'
  | 'locked'
  | 'unknown';

export interface RuntimeAccountLifecycleContext {
  readonly authReady: boolean;
  readonly authUid: string | null | undefined;
  readonly userResolved: boolean;
  readonly user: IUserDados | null | undefined;
}

const ACCOUNT_STATUSES = new Set<AccountStatus>([
  'active',
  'self_suspended',
  'moderation_suspended',
  'pending_deletion',
  'deleted',
]);

/**
 * Normaliza exclusivamente o documento de usuário já disponível.
 *
 * Inconsistências fortes prevalecem sobre um `accountStatus: active` nominal:
 * uma conta tecnicamente locked/suspended ou com interação bloqueada nunca deve
 * ser liberada por projeção atrasada ou documento parcialmente migrado.
 */
export function normalizeUserAccountLifecycleStatus(
  user: IUserDados | null | undefined
): RuntimeAccountLifecycleStatus {
  if (!user) return 'unknown';

  if (user.accountLocked === true || user.loginAllowed === false) {
    return 'locked';
  }

  if (user.suspended === true) {
    return user.suspensionSource === 'self'
      ? 'self_suspended'
      : 'moderation_suspended';
  }

  if (user.deletedAt != null) return 'deleted';
  if (user.deletionRequestedAt != null) return 'pending_deletion';

  if (isPendingRegistration(user)) return 'registration_pending';

  if (user.interactionBlocked === true || user.ageReverificationRestrictedAt != null ||
      (user.profileCompleted !== true && user.moderationAutomationHold?.active === true)) {
    return 'locked';
  }

  const raw = user.accountStatus;

  if (raw === 'active' && user.profileCompleted !== true) return 'registration_pending';

  if (raw && ACCOUNT_STATUSES.has(raw)) return raw;

  return 'unknown';
}

/** O seed privado permite retomar apenas enquanto não houver restrição independente. */
function isPendingRegistration(user: IUserDados): boolean {
  return user.accountStatus === 'active' &&
    user.profileCompleted === false &&
    user.publicVisibility === 'hidden' &&
    user.interactionBlocked === true &&
    user.loginAllowed === true &&
    user.accountLocked !== true &&
    user.suspended !== true &&
    user.deletionRequestedAt == null &&
    user.deletedAt == null &&
    user.registrationCompletedAt == null &&
    (user.registrationFlowVersion === 'v3-private-by-default' ||
      user.registrationSeedSource === 'auth-trigger' ||
      user.registrationSeedSource === 'registration-recovery') &&
    user.ageReverificationRestrictedAt == null &&
    user.moderationAutomationHold?.active !== true;
}

export function canContinueAgeRegistration(context: RuntimeAccountLifecycleContext): boolean {
  return resolveRuntimeAccountLifecycleStatus(context) === 'registration_pending';
}

/**
 * Resolve lifecycle considerando sessão + hidratação do perfil.
 *
 * - auth ainda não resolvido => unknown;
 * - guest confirmado => active (não há conta autenticada a bloquear);
 * - sessão autenticada sem perfil resolvido => unknown;
 * - UID do perfil diferente do Auth => unknown;
 * - perfil coerente => normalização canônica do documento.
 */
export function resolveRuntimeAccountLifecycleStatus(
  context: RuntimeAccountLifecycleContext
): RuntimeAccountLifecycleStatus {
  if (context.authReady !== true) {
    return 'unknown';
  }

  const authUid = String(context.authUid ?? '').trim();
  if (!authUid) {
    return 'active';
  }

  if (context.userResolved !== true || !context.user) {
    return 'unknown';
  }

  const profileUid = String(context.user.uid ?? '').trim();
  if (!profileUid || profileUid !== authUid) {
    return 'unknown';
  }

  return normalizeUserAccountLifecycleStatus(context.user);
}

export function isRuntimeAccountLifecycleBlocked(
  status: RuntimeAccountLifecycleStatus
): boolean {
  return status !== 'active';
}

export function isRuntimeAccountLifecycleResolved(
  status: RuntimeAccountLifecycleStatus
): boolean {
  return status !== 'unknown';
}
