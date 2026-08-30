import type { CommunityErrorMessageMap } from './community-error.messages';

export const COMMUNITY_HIGHLIGHT_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_highlight_unavailable:
      'Os destaques da Comunidade não estão disponíveis neste momento.',
    authentication_required:
      'Entre novamente para continuar.',
    email_verification_required:
      'Verifique seu e-mail antes de alterar o destaque da Comunidade.',
    invalid_community_id:
      'Não foi possível identificar esta Comunidade.',
    invalid_highlight_action:
      'Não foi possível validar esta ação de destaque.',
    invalid_highlight_target:
      'Não foi possível validar a publicação ou a duração do destaque.',
    community_source_not_supported:
      'Este tipo de espaço não oferece publicação fixada.',
    community_unavailable:
      'Esta Comunidade não permite alterar a publicação fixada agora.',
    active_management_required:
      'Somente a gestão ativa da Comunidade pode alterar a publicação fixada.',
    post_unavailable:
      'Esta publicação não pode ser fixada no Mural.',
    community_feed_post_not_found:
      'Esta publicação não está mais disponível.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    request_id_conflict:
      'Esta tentativa não pôde ser confirmada com segurança. Tente novamente.',
    highlight_record_inconsistent:
      'O registro da publicação fixada está inconsistente e exige revisão.',
    account_restricted:
      'Sua conta não pode executar esta ação administrativa neste momento.',
    adult_access_required:
      'Confirme o acesso adulto antes de executar esta ação.',
    profile_incomplete:
      'Complete seu perfil antes de executar esta ação.',
  });

export const COMMUNITY_HIGHLIGHT_LOAD_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'not-found': 'Esta Comunidade não está mais disponível.',
    'permission-denied': 'Você não tem acesso a esta Comunidade.',
    'failed-precondition':
      'A publicação fixada não está disponível neste momento.',
    'invalid-argument':
      'Não foi possível validar esta Comunidade.',
  });

export const COMMUNITY_HIGHLIGHT_ACTION_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'permission-denied':
      'Sua função atual não permite alterar a publicação fixada.',
    'failed-precondition':
      'A publicação fixada não pode ser alterada nas condições atuais.',
    'invalid-argument':
      'Revise a publicação e a duração do destaque.',
    'not-found':
      'Esta publicação ou Comunidade não está mais disponível.',
    'already-exists':
      'Esta tentativa não pôde ser confirmada com segurança. Tente novamente.',
    'data-loss':
      'O registro da publicação fixada está inconsistente e exige revisão.',
  });
