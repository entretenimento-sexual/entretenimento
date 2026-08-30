// src/app/community/presentation/community-error.messages.ts
// -----------------------------------------------------------------------------
// COMMUNITY ERROR MESSAGES - PRESENTATION CATALOG
// -----------------------------------------------------------------------------
// Mensagens de UX para razões/códigos estruturados emitidos pelo backend.
// Este arquivo não define política de domínio nem interpreta erros de transporte:
// a normalização continua centralizada em ApplicationErrorService e as Functions
// permanecem autoritativas sobre reason/recommendedAction.
//
// Os catálogos são separados por contexto porque o mesmo erro técnico pode exigir
// textos diferentes para participante, moderador, proprietário ou destinatário.
// -----------------------------------------------------------------------------

export type CommunityErrorMessageMap = Readonly<Record<string, string>>;

export const COMMUNITY_CREATE_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_creation_limit_reached:
      'Seu plano atingiu a quantidade de Comunidades próprias.',
    community_creation_subscription_required:
      'Uma assinatura Basic ou superior é necessária para criar Comunidades.',
    community_capacity_upgrade_required:
      'Seu plano atual não permite a capacidade escolhida para esta Comunidade.',
    profile_incomplete:
      'Complete seu perfil antes de criar uma Comunidade.',
    adult_access_required:
      'Confirme seu acesso adulto antes de criar uma Comunidade.',
    account_restricted:
      'Sua conta não pode criar Comunidades neste momento.',
  });

export const COMMUNITY_CREATE_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'already-exists':
      'Não foi possível reservar esta Comunidade. Tente novamente.',
    'permission-denied':
      'Sua conta não pode criar esta Comunidade neste momento.',
    'failed-precondition':
      'Sua conta precisa de uma atualização antes de criar uma Comunidade.',
    'invalid-argument':
      'Revise os dados obrigatórios da Comunidade e tente novamente.',
  });

export const COMMUNITY_PREVIEW_LOAD_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'not-found': 'Esta Comunidade não está mais disponível.',
    'permission-denied': 'Você não tem acesso a esta Comunidade.',
  });

export const COMMUNITY_MEMBERSHIP_ACTION_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_capacity_reached:
      'A Comunidade atingiu a capacidade atual. Novas entradas estão pausadas.',
    owner_transfer_required:
      'Transfira a propriedade da Comunidade antes de sair.',
    membership_blocked:
      'Este vínculo está bloqueado e não pode ser alterado.',
    invite_only:
      'A entrada nesta Comunidade é feita somente por convite.',
    actor_restricted:
      'Sua conta não pode participar desta Comunidade neste momento.',
    community_unavailable:
      'Esta Comunidade não aceita novas entradas agora.',
    membership_not_found:
      'Você não possui participação ativa ou pendente nesta Comunidade.',
  });

export const COMMUNITY_MEMBERSHIP_ACTION_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'not-found': 'Esta Comunidade não está mais disponível.',
    'permission-denied':
      'Sua conta não tem permissão para realizar esta ação nesta Comunidade.',
    'failed-precondition':
      'Esta ação não está disponível no estado atual da Comunidade.',
    'invalid-argument': 'Não foi possível validar esta Comunidade.',
    'data-loss':
      'Não foi possível validar o estado atual da Comunidade. Tente novamente.',
  });

export const COMMUNITY_INVITE_INBOX_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    invite_expired: 'Este convite expirou.',
    membership_blocked: 'Você não pode participar desta Comunidade.',
    community_unavailable:
      'Esta Comunidade não está disponível para entrada agora.',
    community_capacity_reached:
      'A Comunidade atingiu a capacidade atual. Novas entradas estão pausadas.',
  });

export const COMMUNITY_INVITE_INBOX_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'not-found': 'Este convite não está mais disponível.',
    'permission-denied': 'Este convite não está disponível para sua conta.',
    'failed-precondition': 'Este convite não está mais disponível.',
  });

export const COMMUNITY_INVITE_MANAGEMENT_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_invites_unavailable:
      'Os convites desta Comunidade não estão disponíveis neste momento.',
    invite_management_forbidden:
      'Seu acesso atual não permite gerenciar convites desta Comunidade.',
    inviter_not_allowed:
      'Seu acesso atual não permite enviar ou revogar este convite.',
    target_already_member:
      'Este perfil já participa da Comunidade.',
    target_blocked:
      'Este perfil não pode receber convites desta Comunidade.',
    community_unavailable:
      'Esta Comunidade não aceita novos convites neste momento.',
    community_capacity_reached:
      'A Comunidade atingiu a capacidade atual. Novos convites estão pausados.',
    self_invite_forbidden:
      'Você não pode enviar um convite para si mesmo.',
    invite_not_found:
      'Este convite não está mais disponível.',
    invite_not_pending:
      'Este convite não está mais pendente.',
    invite_contract_invalid:
      'Este convite não pôde ser validado com segurança.',
    invalid_invite_candidate_query:
      'Revise o apelido informado e tente novamente.',
    invalid_community_id:
      'Não foi possível identificar esta Comunidade.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    account_restricted:
      'Esta conta não pode participar de Comunidades neste momento.',
    adult_access_required:
      'Esta conta precisa confirmar o acesso adulto antes de participar.',
    profile_incomplete:
      'Esta conta precisa concluir o perfil antes de participar.',
  });

export const COMMUNITY_INVITE_MANAGEMENT_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'already-exists': 'Este perfil já participa da Comunidade.',
    'not-found': 'Este convite ou Comunidade não está mais disponível.',
    'permission-denied':
      'Seu acesso atual não permite executar esta ação de convite.',
    'failed-precondition':
      'Este convite não pode ser alterado nas condições atuais.',
    'invalid-argument':
      'Não foi possível validar os dados deste convite.',
  });

export const COMMUNITY_MEMBERSHIP_REVIEW_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_capacity_reached:
      'A capacidade atual foi atingida. A solicitação continua pendente.',
    moderator_required:
      'Seu acesso de moderação não permite revisar esta solicitação.',
    self_review_forbidden:
      'Você não pode revisar a própria solicitação.',
    membership_blocked:
      'Este vínculo está bloqueado e não pode ser alterado.',
    protected_membership:
      'Este participante possui uma função protegida nesta Comunidade.',
    request_not_pending:
      'Esta solicitação já foi processada ou não está mais pendente.',
    account_restricted:
      'A conta deste participante não está elegível para entrada neste momento.',
    adult_access_required:
      'A conta deste participante precisa confirmar o acesso adulto antes da entrada.',
    profile_incomplete:
      'A conta deste participante precisa concluir o perfil antes da entrada.',
    community_not_manageable:
      'Esta Comunidade não pode revisar solicitações no estado atual.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    invalid_membership_review:
      'Não foi possível validar esta solicitação.',
  });

export const COMMUNITY_MEMBERSHIP_REVIEW_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'permission-denied':
      'Seu acesso atual não permite revisar esta solicitação.',
    'failed-precondition':
      'Esta solicitação não pode ser alterada no estado atual.',
    'not-found':
      'Esta solicitação ou Comunidade não está mais disponível.',
    'invalid-argument':
      'Não foi possível validar esta solicitação.',
  });

export const COMMUNITY_SETTINGS_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'recent-authentication-required':
      'Por segurança, saia e entre novamente antes de alterar a capacidade.',
    owner_required_for_capacity:
      'Somente o proprietário pode alterar a capacidade de membros.',
    community_capacity_below_member_count:
      'O limite não pode ser menor que a quantidade atual de membros.',
    community_capacity_upgrade_required:
      'Seu plano atual não permite essa capacidade de membros.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    community_settings_forbidden:
      'Seu acesso atual não permite alterar estas configurações.',
    invalid_community_settings:
      'Revise os dados das configurações e tente novamente.',
    account_restricted:
      'Sua conta não pode alterar estas configurações neste momento.',
    adult_access_required:
      'Confirme o acesso adulto antes de alterar estas configurações.',
    profile_incomplete:
      'Complete seu perfil antes de alterar estas configurações.',
  });

export const COMMUNITY_SETTINGS_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'permission-denied':
      'Seu acesso atual não permite alterar estas configurações.',
    'failed-precondition':
      'Estas configurações não podem ser alteradas no estado atual.',
    'invalid-argument':
      'Revise os dados das configurações e tente novamente.',
    'not-found':
      'Esta Comunidade não está mais disponível.',
    'resource-exhausted':
      'Seu plano atual não permite essa capacidade de membros.',
  });
