// src/app/core/access/content-access-policy.model.ts
// -----------------------------------------------------------------------------
// CONTENT ACCESS POLICY MODEL
// -----------------------------------------------------------------------------
// Contrato neutro de autorização para superfícies públicas, de membros e
// assinantes. Não concede entitlement e não conhece provedores de pagamento.
// -----------------------------------------------------------------------------

import { UserTierRole } from '../interfaces/iuser-dados';

export type ContentAccessMinimumRole = Exclude<
  UserTierRole,
  'visitante' | 'admin'
>;

export type ContentAccessProfileField =
  | 'nickname'
  | 'photoURL'
  | 'gender'
  | 'orientation'
  | 'estado'
  | 'municipio';

export type ContentAccessDenialReason =
  | 'unauthenticated'
  | 'account_restricted'
  | 'adult_access_required'
  | 'profile_incomplete'
  | 'profile_field_missing'
  | 'role_insufficient'
  | 'subscription_inactive';

export type ContentAccessRecommendedAction =
  | 'sign_in'
  | 'review_account'
  | 'confirm_adult_access'
  | 'complete_profile'
  | 'upgrade_subscription'
  | null;

export interface ContentAccessPolicy {
  /** Nível mínimo do perfil. Admin sempre possui cobertura hierárquica. */
  minimumRole?: ContentAccessMinimumRole;

  /** Exige assinatura ativa e ainda não expirada, confirmada pelo backend. */
  requiresActiveSubscription?: boolean;

  /** Exige perfil marcado como concluído. */
  requiresCompletedProfile?: boolean;

  /**
   * Exige elegibilidade adulta conforme os campos de consentimento e
   * reverificação já presentes no perfil.
   */
  requiresAdultAccess?: boolean;

  /** Bloqueia contas suspensas, travadas ou com interação impedida. */
  blockRestrictedAccounts?: boolean;

  /** Campos mínimos de perfil necessários para esta experiência. */
  requiredProfileFields?: readonly ContentAccessProfileField[];
}

export interface ContentAccessDecision {
  allowed: boolean;
  reason: ContentAccessDenialReason | null;
  recommendedAction: ContentAccessRecommendedAction;
  minimumRole: ContentAccessMinimumRole | null;
  missingProfileFields: readonly ContentAccessProfileField[];
}

export const PUBLIC_CONTENT_ACCESS_POLICY: Readonly<ContentAccessPolicy> =
  Object.freeze({
    blockRestrictedAccounts: true,
  });

/**
 * Política base para conteúdos de assinantes em uma plataforma adulta.
 * A tela pode complementar os campos obrigatórios conforme a experiência.
 */
export function createSubscriberContentAccessPolicy(
  minimumRole: ContentAccessMinimumRole = 'basic',
  requiredProfileFields: readonly ContentAccessProfileField[] = []
): Readonly<ContentAccessPolicy> {
  return Object.freeze({
    minimumRole,
    requiresActiveSubscription: true,
    requiresCompletedProfile: true,
    requiresAdultAccess: true,
    blockRestrictedAccounts: true,
    requiredProfileFields: Object.freeze([...requiredProfileFields]),
  });
}
