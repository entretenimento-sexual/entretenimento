// src/app/account/guards/account-lifecycle-status.util.ts
// -----------------------------------------------------------------------------
// Adaptador de compatibilidade para a política canônica de lifecycle.
// -----------------------------------------------------------------------------
// Os nomes públicos existentes são preservados para não quebrar consumidores,
// mas a interpretação do estado passa a delegar integralmente para a política
// única mantida no core de autenticação.

import type { IUserDados } from '@core/interfaces/iuser-dados';
import {
  isRuntimeAccountLifecycleBlocked,
  isRuntimeAccountLifecycleResolved,
  normalizeUserAccountLifecycleStatus,
  resolveRuntimeAccountLifecycleStatus,
  type RuntimeAccountLifecycleContext,
  type RuntimeAccountLifecycleStatus,
} from '@core/services/autentication/auth/account-lifecycle.policy';

export type LifecycleAccountStatus = RuntimeAccountLifecycleStatus;
export type LifecycleAccountStatusResolution = RuntimeAccountLifecycleStatus;

/**
 * Compatibilidade para consumidores que já possuem o documento de usuário.
 * `null`, `undefined`, lock técnico e status inesperado falham fechado.
 */
export function normalizeAccountStatus(
  user: unknown
): LifecycleAccountStatusResolution {
  return normalizeUserAccountLifecycleStatus(
    user as IUserDados | null | undefined
  );
}

/**
 * Resolução completa para guards: considera Auth pronto, UID canônico e
 * reconciliação do perfil runtime antes de liberar a navegação.
 */
export function resolveAccountStatus(
  context: RuntimeAccountLifecycleContext
): LifecycleAccountStatusResolution {
  return resolveRuntimeAccountLifecycleStatus(context);
}

export function isRestrictedAccountStatus(
  status: LifecycleAccountStatusResolution
): boolean {
  return isRuntimeAccountLifecycleBlocked(status);
}

export function isResolvedAccountStatus(
  status: LifecycleAccountStatusResolution
): boolean {
  return isRuntimeAccountLifecycleResolved(status);
}
