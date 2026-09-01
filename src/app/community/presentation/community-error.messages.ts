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
    community_runtime_unavailable:
      'As ações da Comunidade estão temporariamente indisponíveis. Tente novamente.',
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
    invalid_invite_identity:
      'Não foi possível validar este convite.',
    invalid_invite_id:
      'Este convite não é válido ou não está mais disponível.',
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
    invalid_invite_identity:
      'Não foi possível validar este convite.',
    invalid_invite_id:
      'Este convite não é válido ou não está mais disponível.',
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

export const COMMUNITY_TOPIC_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_topics_unavailable:
      'As Discussões desta Comunidade não estão disponíveis neste momento.',
    community_topic_rate_limited:
      'Você atingiu o limite temporário de interações em Discussões. Tente novamente mais tarde.',
    community_interaction_forbidden:
      'Sua participação atual não permite interagir nesta Comunidade.',
    topic_creation_forbidden:
      'Sua participação atual não permite criar discussões.',
    topic_reply_forbidden:
      'Sua participação atual não permite responder nesta discussão.',
    topic_not_found:
      'Esta discussão não está mais disponível.',
    topic_not_replyable:
      'Esta discussão não aceita novas respostas.',
    invalid_topic_request:
      'Revise o título e a mensagem da discussão.',
    invalid_topic_reply:
      'Revise a resposta e tente novamente.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    request_id_conflict:
      'Esta tentativa não pôde ser confirmada com segurança. Tente novamente.',
    account_restricted:
      'Sua conta não pode interagir em Comunidades neste momento.',
    adult_access_required:
      'Confirme o acesso adulto antes de interagir nesta Comunidade.',
    profile_incomplete:
      'Complete seu perfil antes de interagir nesta Comunidade.',
  });

export const COMMUNITY_TOPIC_CREATE_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'resource-exhausted':
      'Você atingiu o limite temporário de interações em Discussões. Tente novamente mais tarde.',
    'permission-denied':
      'Sua participação atual não permite criar discussões.',
    'failed-precondition':
      'Sua conta ou esta discussão precisa ser atualizada antes desta interação.',
    'not-found':
      'Esta Comunidade não está mais disponível.',
    'invalid-argument':
      'Revise o título e a mensagem da discussão.',
  });

export const COMMUNITY_TOPIC_REPLY_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'resource-exhausted':
      'Você atingiu o limite temporário de interações em Discussões. Tente novamente mais tarde.',
    'permission-denied':
      'Sua participação atual não permite responder nesta discussão.',
    'failed-precondition':
      'Sua conta ou esta discussão precisa ser atualizada antes desta interação.',
    'not-found':
      'Esta discussão não está mais disponível.',
    'invalid-argument':
      'Revise a resposta e tente novamente.',
  });

export const COMMUNITY_TOPIC_MODERATION_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_topic_moderation_unavailable:
      'A moderação de Discussões não está disponível neste momento.',
    invalid_topic_moderation_action:
      'Esta ação de moderação da discussão não é válida.',
    topic_moderation_forbidden:
      'Sua função atual não permite moderar esta discussão.',
    removal_reason_required:
      'Informe um motivo com pelo menos 3 caracteres para remover a discussão.',
    removal_reason_too_long:
      'O motivo da remoção deve ter no máximo 240 caracteres.',
    removed_topic:
      'Uma discussão removida não pode ser reaberta.',
    topic_transition_forbidden:
      'O estado atual desta discussão não permite esta ação.',
    topic_not_found:
      'Esta discussão não está mais disponível.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    request_id_conflict:
      'Esta tentativa de moderação não pôde ser confirmada com segurança.',
    moderation_record_inconsistent:
      'O registro desta moderação está inconsistente e exige revisão.',
    topic_projection_inconsistent:
      'A discussão está inconsistente e exige revisão antes de nova moderação.',
    account_restricted:
      'Sua conta não pode executar esta ação administrativa neste momento.',
    adult_access_required:
      'Confirme o acesso adulto antes de executar esta ação.',
    profile_incomplete:
      'Complete seu perfil antes de executar esta ação.',
  });

export const COMMUNITY_TOPIC_MODERATION_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'permission-denied':
      'Sua função atual não permite moderar esta discussão.',
    'invalid-argument':
      'Revise o motivo e tente novamente.',
    'failed-precondition':
      'O estado desta discussão mudou. Atualize a discussão antes de moderar novamente.',
    'not-found':
      'Esta discussão não está mais disponível.',
    'data-loss':
      'A discussão está inconsistente e exige revisão antes de nova moderação.',
  });

export const COMMUNITY_MEMBER_MANAGEMENT_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'recent-authentication-required':
      'Por segurança, saia e entre novamente antes de confirmar esta ação administrativa.',
    community_source_not_supported:
      'Esta ação não está disponível para este tipo de espaço.',
    community_management_unavailable:
      'A gestão de participantes está temporariamente indisponível.',
    invalid_management_query:
      'Não foi possível carregar os participantes com este filtro.',
    invalid_member_management_action:
      'Esta ação de gestão não é válida.',
    invalid_community_role:
      'O papel selecionado não é válido para esta Comunidade.',
    manager_required:
      'Sua função não permite gerenciar participantes desta Comunidade.',
    self_action_forbidden:
      'Use os controles da sua própria participação para alterar seu vínculo.',
    owner_protected:
      'O proprietário só pode ser alterado pelo fluxo de transferência de propriedade.',
    target_unavailable:
      'O vínculo deste participante não permite esta ação agora.',
    role_change_forbidden:
      'Sua função não permite atribuir este papel ao participante.',
    action_forbidden:
      'Sua função não permite executar esta ação sobre este participante.',
  });

export const COMMUNITY_MEMBER_MANAGEMENT_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'permission-denied':
      'Sua função não permite executar esta ação sobre este participante.',
    'failed-precondition':
      'O vínculo deste participante não permite esta ação agora.',
    'invalid-argument':
      'Não foi possível validar esta alteração de participante.',
    'not-found':
      'Este participante ou Comunidade não está mais disponível.',
  });

export const COMMUNITY_OWNERSHIP_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'recent-authentication-required':
      'Por segurança, saia e entre novamente antes de confirmar esta ação.',
    community_source_not_supported:
      'Esta ação não está disponível para este tipo de espaço.',
    owner_required:
      'Apenas o proprietário pode executar esta ação.',
    ownership_inconsistent:
      'A propriedade está inconsistente. A operação foi bloqueada para revisão.',
    self_transfer_forbidden:
      'Selecione outro membro para receber a propriedade.',
    target_membership_ineligible:
      'O participante selecionado não possui vínculo ativo elegível.',
    target_account_ineligible:
      'A conta selecionada não pode assumir a propriedade agora.',
    community_lifecycle_hold:
      'Esta Comunidade possui retenção operacional e não pode ser arquivada.',
  });

export const COMMUNITY_OWNERSHIP_LOAD_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'data-loss':
      'A propriedade está inconsistente. A operação foi bloqueada para revisão.',
  });

export const COMMUNITY_OWNERSHIP_ACTION_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'data-loss':
      'A propriedade está inconsistente. A operação foi bloqueada para revisão.',
    'permission-denied':
      'Sua conta não pode executar esta ação administrativa.',
    'failed-precondition':
      'Esta ação não está disponível no estado atual da Comunidade.',
    'invalid-argument':
      'Não foi possível validar os dados desta ação.',
    'not-found':
      'Esta Comunidade ou participante não está mais disponível.',
  });

export const COMMUNITY_FEED_POST_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_feed_unavailable:
      'As publicações desta Comunidade não estão disponíveis neste momento.',
    community_feed_actions_unavailable:
      'As ações desta publicação não estão disponíveis neste momento.',
    authentication_required:
      'Entre novamente para continuar no Mural.',
    email_verification_required:
      'Verifique seu e-mail antes de publicar ou administrar o Mural.',
    community_feed_rate_limited:
      'Você atingiu o limite temporário de mensagens. Tente mais tarde.',
    active_membership_required:
      'Participe da Comunidade para publicar no Mural.',
    community_unavailable:
      'O Mural desta Comunidade não aceita publicações agora.',
    invalid_post_request:
      'Não foi possível validar esta publicação.',
    multiple_attachments_not_allowed:
      'Adicione apenas uma foto ou uma localização por publicação.',
    empty_post:
      'Escreva uma mensagem ou adicione uma foto ou localização.',
    image_not_owned:
      'A foto selecionada não pode ser usada por esta conta.',
    invalid_image_type:
      'A foto deve ser JPG, PNG ou WEBP.',
    invalid_image:
      'Não foi possível validar a foto enviada.',
    image_too_large:
      'A foto excede o limite de 10 MB.',
    request_id_conflict:
      'Esta tentativa não pôde ser confirmada com segurança. Tente novamente.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    community_feed_post_not_found:
      'Esta publicação não está mais disponível.',
    post_already_exists:
      'Esta publicação já foi confirmada.',
    referenced_post_unavailable:
      'A publicação original não está disponível para resposta.',
    post_author_required:
      'Somente o autor pode excluir esta publicação.',
    active_management_required:
      'Somente a gestão ativa da Comunidade pode remover esta publicação.',
    removal_reason_required:
      'Informe um motivo com pelo menos 3 caracteres para remover a publicação.',
    removal_reason_too_long:
      'O motivo da remoção deve ter no máximo 240 caracteres.',
    post_unavailable:
      'Esta publicação não permite esta ação agora.',
    invalid_post_action:
      'Não foi possível validar esta ação sobre a publicação.',
    moderation_record_inconsistent:
      'O registro desta ação está inconsistente e exige revisão.',
    post_projection_inconsistent:
      'A publicação está inconsistente e exige revisão antes de nova ação.',
    account_restricted:
      'Sua conta não pode publicar ou administrar Comunidades neste momento.',
    adult_access_required:
      'Confirme o acesso adulto antes de continuar nesta Comunidade.',
    profile_incomplete:
      'Complete seu perfil antes de continuar nesta Comunidade.',
  });

export const COMMUNITY_FEED_POST_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'resource-exhausted':
      'Você atingiu o limite temporário de mensagens. Tente mais tarde.',
    'permission-denied':
      'Sua participação atual não permite publicar no Mural.',
    'failed-precondition':
      'O Mural desta Comunidade não aceita publicações agora.',
    'invalid-argument':
      'Revise a mensagem e tente novamente.',
    'not-found':
      'Esta Comunidade ou publicação não está mais disponível.',
    'already-exists':
      'Esta tentativa de publicação não pôde ser confirmada com segurança. Tente novamente.',
  });

export const COMMUNITY_FEED_POST_ACTION_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'permission-denied':
      'Sua função atual não permite executar esta ação sobre a publicação.',
    'invalid-argument':
      'Revise os dados da ação e tente novamente.',
    'failed-precondition':
      'Esta publicação não permite a ação solicitada agora.',
    'not-found':
      'Esta publicação ou Comunidade não está mais disponível.',
    'data-loss':
      'A publicação está inconsistente e exige revisão antes de nova ação.',
    'already-exists':
      'Esta tentativa não pôde ser confirmada com segurança. Tente novamente.',
  });

export const COMMUNITY_FEED_REACTION_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_feed_reactions_unavailable:
      'As reações do Mural não estão disponíveis neste momento.',
    community_feed_reaction_unavailable:
      'Esta publicação não aceita reações agora.',
    active_membership_required:
      'Participe da Comunidade para curtir publicações.',
    community_unavailable:
      'Esta Comunidade não aceita interações agora.',
    post_unavailable:
      'Esta publicação não aceita reações agora.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    community_feed_post_not_found:
      'Esta publicação não está mais disponível.',
    invalid_reaction_request:
      'Não foi possível validar esta reação.',
    authentication_required:
      'Entre novamente para reagir a esta publicação.',
    email_verification_required:
      'Verifique seu e-mail antes de reagir nesta Comunidade.',
    account_restricted:
      'Sua conta não pode interagir em Comunidades neste momento.',
    adult_access_required:
      'Confirme o acesso adulto antes de interagir nesta Comunidade.',
    profile_incomplete:
      'Complete seu perfil antes de interagir nesta Comunidade.',
  });

export const COMMUNITY_FEED_REACTION_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'resource-exhausted':
      'Você reagiu muitas vezes em pouco tempo. Aguarde um instante.',
    'permission-denied':
      'Participe da Comunidade para curtir publicações.',
    'failed-precondition':
      'Esta publicação não aceita reações agora.',
    'not-found':
      'Esta publicação não está mais disponível.',
    'invalid-argument':
      'Não foi possível validar esta reação.',
  });

export const COMMUNITY_FEED_REFERENCE_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'not-found':
      'A publicação original não está disponível neste momento.',
  });

export const COMMUNITY_FEED_CONVERSATION_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_feed_conversation_unavailable:
      'A conversa do Mural não está disponível neste momento.',
    community_feed_comment_actions_unavailable:
      'As ações desta mensagem não estão disponíveis neste momento.',
    authentication_required:
      'Entre novamente para continuar nesta conversa.',
    email_verification_required:
      'Verifique seu e-mail antes de responder nesta Comunidade.',
    community_feed_rate_limited:
      'Você enviou muitas mensagens em pouco tempo. Aguarde um instante.',
    active_membership_required:
      'Participe da Comunidade para responder no Mural.',
    community_unavailable:
      'A conversa desta publicação não está disponível agora.',
    post_unavailable:
      'Esta publicação não aceita novas mensagens agora.',
    invalid_conversation_message:
      'Revise a mensagem e tente novamente.',
    invalid_conversation_reply:
      'Não foi possível publicar esta resposta. Atualize a conversa e tente novamente.',
    request_id_conflict:
      'Esta tentativa não pôde ser confirmada com segurança. Tente novamente.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    community_feed_post_not_found:
      'Esta publicação não está mais disponível.',
    community_feed_reply_not_found:
      'Esta resposta não está mais disponível.',
    conversation_message_already_exists:
      'Esta mensagem já foi confirmada.',
    conversation_reply_already_exists:
      'Esta resposta já foi publicada.',
    referenced_message_unavailable:
      'A mensagem original não está disponível para resposta.',
    comment_author_required:
      'Somente o autor pode excluir esta mensagem.',
    active_management_required:
      'Somente a gestão ativa da Comunidade pode remover esta mensagem.',
    removal_reason_required:
      'Informe um motivo com pelo menos 3 caracteres para remover a mensagem.',
    removal_reason_too_long:
      'O motivo da remoção deve ter no máximo 240 caracteres.',
    comment_unavailable:
      'Esta mensagem não permite esta ação agora.',
    invalid_comment_action:
      'Não foi possível validar esta ação sobre a mensagem.',
    moderation_record_inconsistent:
      'O registro desta ação está inconsistente e exige revisão.',
    community_feed_comment_not_found:
      'Esta mensagem não está mais disponível.',
    account_restricted:
      'Sua conta não pode interagir em Comunidades neste momento.',
    adult_access_required:
      'Confirme o acesso adulto antes de responder nesta Comunidade.',
    profile_incomplete:
      'Complete seu perfil antes de responder nesta Comunidade.',
  });

export const COMMUNITY_FEED_CONVERSATION_CREATE_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'resource-exhausted':
      'Você enviou muitas mensagens em pouco tempo. Aguarde um instante.',
    'permission-denied':
      'Participe da Comunidade para responder no Mural.',
    'failed-precondition':
      'Esta publicação não aceita novas mensagens agora.',
    'not-found':
      'Esta publicação ou Comunidade não está mais disponível.',
    'invalid-argument':
      'Revise a mensagem e tente novamente.',
    'already-exists':
      'Esta tentativa não pôde ser confirmada com segurança. Tente novamente.',
  });

export const COMMUNITY_FEED_CONVERSATION_ACTION_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    'permission-denied':
      'Sua função atual não permite executar esta ação sobre a mensagem.',
    'invalid-argument':
      'Revise os dados da ação e tente novamente.',
    'failed-precondition':
      'Esta mensagem não permite a ação solicitada agora.',
    'not-found':
      'Esta mensagem ou Comunidade não está mais disponível.',
    'data-loss':
      'A mensagem está inconsistente e exige revisão antes de nova ação.',
    'already-exists':
      'Esta tentativa não pôde ser confirmada com segurança. Tente novamente.',
  });
