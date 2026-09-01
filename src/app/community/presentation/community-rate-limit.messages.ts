// src/app/community/presentation/community-rate-limit.messages.ts
// -----------------------------------------------------------------------------
// COMMUNITY RATE LIMIT MESSAGES
// -----------------------------------------------------------------------------
// Mensagens contextuais para os bloqueios operacionais de antiabuso emitidos
// pelo backend. A classificação do erro continua centralizada no
// ApplicationErrorService; este catálogo contém somente texto seguro de UX.
// -----------------------------------------------------------------------------

export const COMMUNITY_RATE_LIMIT_REASON_MESSAGES: Readonly<Record<string, string>> =
  Object.freeze({
    community_feed_rate_limited:
      'Você publicou muitas vezes em pouco tempo. Aguarde um instante e tente novamente.',
    community_feed_conversation_rate_limited:
      'Você enviou muitas mensagens em pouco tempo. Aguarde um instante e tente novamente.',
    community_feed_reaction_rate_limited:
      'Você reagiu muitas vezes em pouco tempo. Aguarde um instante e tente novamente.',
    community_report_rate_limited:
      'Muitas denúncias foram enviadas em pouco tempo. Aguarde um instante e tente novamente.',
    community_invite_rate_limited:
      'Você enviou muitos convites em pouco tempo. Aguarde e tente novamente.',
    community_membership_rate_limited:
      'Você tentou entrar em muitas Comunidades em pouco tempo. Aguarde e tente novamente.',
    community_management_rate_limited:
      'Muitas ações de gestão foram executadas em pouco tempo. Aguarde e tente novamente.',
  });
