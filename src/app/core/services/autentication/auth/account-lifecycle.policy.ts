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
 * uma conta tecnicamente locked/suspended nunca deve ser liberada por projeção
 * atrasada ou documento parcialmente migrado.
 */
export function normalizeUserAccountLifecycleStatus(
  user: IUserDados | null | undefined
): RuntimeAccountLifecycleStatus {
  if (!user) return 'unknown';

  if (user.accountLocked === true) {
    return 'locked';
  }

  if (user.suspended === true) {
    return user.suspensionSource === 'self'
      ? 'self_suspended'
      : 'moderation_suspended';
  }

  const raw = String(user.accountStatus ?? '')
    .trim()
    .toLowerCase();

  if (ACCOUNT_STATUSES.has(raw as AccountStatus)) {
    return raw as AccountStatus;
  }

  // Documento legado sem accountStatus continua equivalente a ativo quando
  // não existem flags restritivas. Valor não vazio e desconhecido falha fechado.
  return raw ? 'unknown' : 'active';
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
