// src/app/core/interfaces/interfaces-user-dados/user-access-control.interface.ts
// =============================================================================
// USER ACCESS CONTROL — padrão evoluído para lifecycle real de conta
//
// Separação intencional:
// - tier/plano monetário
// - roles/permissões de staff
// - entitlements
// - lifecycle/status operacional da conta
//
// OBSERVAÇÃO IMPORTANTE:
// - No projeto atual, IUserDados.role continua sendo o tier legad o.
// - Este contrato existe para consolidar a direção arquitetural correta
//   sem quebrar o que já funciona hoje.
// =============================================================================

import { IUserDados } from '../iuser-dados';

export type Tier = Exclude<IUserDados['role'], 'visitante'>;

export type AccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

export type StaffRole =
  | 'user'
  | 'moderator'
  | 'support'
  | 'admin'
  | 'superadmin';

export type Permission = string;
export type Entitlement = string;

export interface IUserAccessControl {
  /**
   * Monetização / plano.
   * Mantém coerência com billing e com o role legado.
   */
  tier: Tier;

  /**
   * Autorização de staff.
   * Em evolução futura, o ideal é refletir isso também em custom claims.
   */
  roles: StaffRole[];
  permissions: Permission[];

  /**
   * Direitos de produto.
   */
  entitlements: Entitlement[];

  /**
   * Lifecycle da conta.
   */
  accountStatus: AccountStatus;

  /**
   * Regras operacionais derivadas do lifecycle.
   */
  publicVisibility: 'visible' | 'hidden';
  interactionBlocked: boolean;
  loginAllowed: boolean;

  /**
   * Holds de retenção mínima / proteção de expurgo.
   */
  legalHold: boolean;
  billingHold: boolean;
}

export const DEFAULT_ACCESS_CONTROL: IUserAccessControl = {
  tier: 'basic',
  roles: ['user'],
  permissions: [],
  entitlements: [],

  accountStatus: 'active',
  publicVisibility: 'visible',
  interactionBlocked: false,
  loginAllowed: true,

  legalHold: false,
  billingHold: false,
};