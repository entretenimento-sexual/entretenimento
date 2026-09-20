// src/app/community/presentation/community-error.catalog.ts
import type { ApplicationErrorPresentation } from
  'src/app/core/services/error-handler/application-error-presentation.model';
import {
  COMMUNITY_CREATE_REASON_MESSAGES,
  COMMUNITY_OFFICIAL_CREATE_REASON_MESSAGES,
  COMMUNITY_FEED_CONVERSATION_REASON_MESSAGES,
  COMMUNITY_FEED_POST_REASON_MESSAGES,
  COMMUNITY_FEED_REACTION_REASON_MESSAGES,
  COMMUNITY_INVITE_INBOX_REASON_MESSAGES,
  COMMUNITY_INVITE_MANAGEMENT_REASON_MESSAGES,
  COMMUNITY_MEMBER_MANAGEMENT_REASON_MESSAGES,
  COMMUNITY_MEMBERSHIP_ACTION_REASON_MESSAGES,
  COMMUNITY_MEMBERSHIP_REVIEW_REASON_MESSAGES,
  COMMUNITY_OWNERSHIP_REASON_MESSAGES,
  COMMUNITY_SETTINGS_REASON_MESSAGES,
  COMMUNITY_TOPIC_MODERATION_REASON_MESSAGES,
  COMMUNITY_TOPIC_REASON_MESSAGES,
} from './community-error.messages';
import { COMMUNITY_HIGHLIGHT_REASON_MESSAGES } from './community-highlight-error.messages';
import { COMMUNITY_MEMBER_ROSTER_REASON_MESSAGES } from './community-member-roster-error.messages';
import { COMMUNITY_MEMBERSHIP_PROFILE_VISIBILITY_REASON_MESSAGES } from './community-membership-profile-visibility-error.messages';
import { COMMUNITY_MEMBERSHIP_STATE_REASON_MESSAGES } from './community-membership-state-error.messages';
import { COMMUNITY_NOTIFICATION_PREFERENCE_REASON_MESSAGES } from './community-notification-preference-error.messages';
import { COMMUNITY_RATE_LIMIT_REASON_MESSAGES } from './community-rate-limit.messages';
import { COMMUNITY_SOCIAL_ACCESS_REASON_MESSAGES } from './community-social-access-error.messages';
import {
  COMMUNITY_PUBLIC_ERROR_REASONS,
  isCommunityPublicErrorReason,
  type CommunityPublicErrorReason,
} from './community-error-reason.contract';

export const COMMUNITY_PUBLIC_REASON_MESSAGES = Object.freeze({
  ...COMMUNITY_CREATE_REASON_MESSAGES,
  ...COMMUNITY_OFFICIAL_CREATE_REASON_MESSAGES,
  ...COMMUNITY_MEMBERSHIP_ACTION_REASON_MESSAGES,
  ...COMMUNITY_INVITE_INBOX_REASON_MESSAGES,
  ...COMMUNITY_INVITE_MANAGEMENT_REASON_MESSAGES,
  ...COMMUNITY_MEMBERSHIP_REVIEW_REASON_MESSAGES,
  ...COMMUNITY_SETTINGS_REASON_MESSAGES,
  ...COMMUNITY_TOPIC_REASON_MESSAGES,
  ...COMMUNITY_TOPIC_MODERATION_REASON_MESSAGES,
  ...COMMUNITY_MEMBER_MANAGEMENT_REASON_MESSAGES,
  ...COMMUNITY_OWNERSHIP_REASON_MESSAGES,
  ...COMMUNITY_FEED_POST_REASON_MESSAGES,
  ...COMMUNITY_FEED_REACTION_REASON_MESSAGES,
  ...COMMUNITY_FEED_CONVERSATION_REASON_MESSAGES,
  ...COMMUNITY_HIGHLIGHT_REASON_MESSAGES,
  ...COMMUNITY_MEMBER_ROSTER_REASON_MESSAGES,
  ...COMMUNITY_MEMBERSHIP_PROFILE_VISIBILITY_REASON_MESSAGES,
  ...COMMUNITY_MEMBERSHIP_STATE_REASON_MESSAGES,
  ...COMMUNITY_NOTIFICATION_PREFERENCE_REASON_MESSAGES,
  ...COMMUNITY_RATE_LIMIT_REASON_MESSAGES,
  ...COMMUNITY_SOCIAL_ACCESS_REASON_MESSAGES,
}) as Readonly<Record<CommunityPublicErrorReason, string>>;

const SNACKBAR_ERROR: Readonly<ApplicationErrorPresentation> =
  Object.freeze({ surface: 'snackbar', severity: 'error' });
const SNACKBAR_INFO: Readonly<ApplicationErrorPresentation> =
  Object.freeze({ surface: 'snackbar', severity: 'info' });

const BLOCKING_PRESENTATIONS: Readonly<
  Partial<Record<CommunityPublicErrorReason, ApplicationErrorPresentation>>
> = Object.freeze({
  'recent-authentication-required': { surface: 'modal', severity: 'warning', title: 'Confirme sua identidade novamente' },
  current_terms_required: { surface: 'modal', severity: 'info', title: 'Termos atualizados', primaryAction: { label: 'Revisar termos', route: '/register/aceitar-termos' }, dismissLabel: 'Agora não' },
  age_reverification_required: { surface: 'modal', severity: 'warning', title: 'Confirmação de maioridade necessária', primaryAction: { label: 'Revalidar agora', route: '/adulto/revalidar' }, dismissLabel: 'Agora não' },
  adult_access_required: { surface: 'modal', severity: 'info', title: 'Confirme seu acesso adulto', primaryAction: { label: 'Confirmar acesso', route: '/adulto/confirmar' }, dismissLabel: 'Agora não' },
  adult_access_denied: { surface: 'modal', severity: 'warning', title: 'Acesso adulto indisponível', primaryAction: { label: 'Ver status da conta', route: '/conta/status' }, dismissLabel: 'Fechar' },
  account_restricted: { surface: 'modal', severity: 'warning', title: 'Ação bloqueada pelo estado da conta', primaryAction: { label: 'Ver status da conta', route: '/conta/status' }, dismissLabel: 'Fechar' },
  profile_incomplete: { surface: 'modal', severity: 'info', title: 'Complete seu perfil', primaryAction: { label: 'Finalizar perfil', route: '/register/finalizar-cadastro' }, dismissLabel: 'Agora não' },
  community_creation_subscription_required: { surface: 'modal', severity: 'info', title: 'Assinatura necessária para criar', primaryAction: { label: 'Ver planos', route: '/subscription-plan' }, dismissLabel: 'Agora não' },
  community_creation_limit_reached: { surface: 'modal', severity: 'info', title: 'Limite de Comunidades atingido', primaryAction: { label: 'Gerenciar Comunidades', route: '/dashboard/comunidades/minhas' }, dismissLabel: 'Continuar aqui' },
  community_capacity_upgrade_required: { surface: 'modal', severity: 'info', title: 'Capacidade indisponível no plano atual', primaryAction: { label: 'Ver planos', route: '/subscription-plan' }, dismissLabel: 'Revisar capacidade' },
  official_target_already_associated: { surface: 'modal', severity: 'info', title: 'Comunidade Oficial já existente' },
  official_creation_verification_required: { surface: 'modal', severity: 'info', title: 'Verificação oficial necessária' },
  official_creation_verification_inactive: { surface: 'modal', severity: 'warning', title: 'Verificação oficial inativa' },
  official_creation_target_inactive: { surface: 'modal', severity: 'warning', title: 'Alvo oficial inativo' },
  official_creation_target_authority_mismatch: { surface: 'modal', severity: 'warning', title: 'Autoridade oficial não confirmada' },
  official_creation_unsupported_target: { surface: 'modal', severity: 'warning', title: 'Alvo oficial não suportado' },
  owner_transfer_required: { surface: 'modal', severity: 'warning', title: 'Transfira a propriedade antes de sair' },
  owner_protected: { surface: 'modal', severity: 'warning', title: 'Proprietário protegido' },
  membership_blocked: { surface: 'modal', severity: 'warning', title: 'Participação bloqueada' },
  membership_status_invalid: { surface: 'modal', severity: 'warning', title: 'Participação inconsistente' },
  ownership_inconsistent: { surface: 'modal', severity: 'warning', title: 'Propriedade inconsistente' },
  community_ownership_idempotency_invalid: { surface: 'modal', severity: 'warning', title: 'Confirmação de propriedade inconsistente' },
  community_settings_idempotency_invalid: { surface: 'modal', severity: 'warning', title: 'Confirmação de configuração inconsistente' },
  community_lifecycle_hold: { surface: 'modal', severity: 'warning', title: 'Operação retida' },
  membership_disclosure_invalid: { surface: 'modal', severity: 'warning', title: 'Política de privacidade inconsistente' },
  community_membership_profile_visibility_invalid: { surface: 'modal', severity: 'warning', title: 'Preferência de visibilidade inconsistente' },
  moderation_record_inconsistent: { surface: 'modal', severity: 'warning', title: 'Registro de moderação inconsistente' },
  post_projection_inconsistent: { surface: 'modal', severity: 'warning', title: 'Publicação inconsistente' },
  topic_projection_inconsistent: { surface: 'modal', severity: 'warning', title: 'Discussão inconsistente' },
  highlight_record_inconsistent: { surface: 'modal', severity: 'warning', title: 'Destaque inconsistente' },
});

export const COMMUNITY_PUBLIC_REASON_PRESENTATIONS = Object.freeze(
  Object.fromEntries(
    COMMUNITY_PUBLIC_ERROR_REASONS.map((reason) => [
      reason,
      BLOCKING_PRESENTATIONS[reason]
        ?? (reason.endsWith('_rate_limited') ? SNACKBAR_INFO : SNACKBAR_ERROR),
    ])
  )
) as Readonly<Record<CommunityPublicErrorReason, ApplicationErrorPresentation>>;

export function resolveCommunityPublicErrorMessage(reason: unknown): string | null {
  return isCommunityPublicErrorReason(reason)
    ? COMMUNITY_PUBLIC_REASON_MESSAGES[reason]
    : null;
}

export function resolveCommunityPublicErrorPresentation(
  reason: unknown
): ApplicationErrorPresentation | null {
  return isCommunityPublicErrorReason(reason)
    ? COMMUNITY_PUBLIC_REASON_PRESENTATIONS[reason]
    : null;
}
