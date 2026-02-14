// src/app/core/interfaces/user-access-control.interface.ts
// =============================================================================
// USER ACCESS CONTROL — “padrão plataforma grande”
//
// Objetivo:
// - Separar claramente:
//   (A) Tier/Plano (monetização)        -> free/basic/premium/vip
//   (B) Roles/Permissions (autorização)-> admin/moderator/... + permissões granulares
//   (C) AccountStatus (enforcement)    -> active/suspended/locked/deleted/pending
//
// Observação:
// - No seu projeto atual, IUserDados.role = TIER.
// - Este “esqueleto” permite evoluir sem quebrar compat.
// =============================================================================
import { IUserDados } from "../iuser-dados";

export type Tier = Exclude<IUserDados['role'], 'visitante'>; // free|basic|premium|vip
export type AccountStatus = 'active' | 'suspended' | 'locked' | 'deleted' | 'pending';

// Roles “staff” (não confundir com tier)
// Em plataformas grandes, isso vira Custom Claims no token.
// Aqui deixamos como esqueleto para evolução.
export type StaffRole = 'user' | 'moderator' | 'support' | 'admin' | 'superadmin';

// Permissões granulares (string por flexibilidade; você pode tipar mais tarde)
export type Permission = string;

// Entitlements = direitos de produto (feature flags monetizáveis ou concedidas)
export type Entitlement = string;

export interface IUserAccessControl {
  // Monetização canônica (futuro)
  tier: Tier;

  // Autorização (futuro)
  roles: StaffRole[];             // ex.: ['user'], ['moderator']
  permissions: Permission[];      // ex.: ['users:suspend', 'reports:read']

  // Feature access (futuro)
  entitlements: Entitlement[];    // ex.: ['nickname:change', 'rooms:create']

  // Segurança/moderação (futuro)
  accountStatus: AccountStatus;   // ex.: 'active'
}

// Defaults “padrão big platform”
export const DEFAULT_ACCESS_CONTROL: IUserAccessControl = {
  tier: 'basic',
  roles: ['user'],
  permissions: [],
  entitlements: [],
  accountStatus: 'active',
};
