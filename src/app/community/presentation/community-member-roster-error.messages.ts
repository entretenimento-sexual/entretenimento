// src/app/community/presentation/community-member-roster-error.messages.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER ROSTER ERROR MESSAGES
// -----------------------------------------------------------------------------
// Catálogo de apresentação da listagem interna de integrantes. O backend continua
// autoritativo sobre `reason`; esta camada apenas traduz o contrato para UX segura.
// -----------------------------------------------------------------------------

import type { CommunityErrorMessageMap } from './community-error.messages';

export const COMMUNITY_MEMBER_ROSTER_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    community_member_roster_unavailable:
      'A lista de integrantes está temporariamente indisponível. Tente novamente.',
    invalid_community_member_roster_cursor:
      'A paginação da lista perdeu a validade. Atualize a lista e tente novamente.',
    invalid_community_member_roster_query:
      'Não foi possível validar esta consulta de integrantes.',
    community_member_roster_membership_required:
      'Somente participantes ativos podem ver os integrantes desta Comunidade.',
    email_verification_required:
      'Verifique seu e-mail antes de consultar os integrantes desta Comunidade.',
  });

export const COMMUNITY_MEMBER_ROSTER_CODE_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    unauthenticated:
      'Entre novamente para consultar os integrantes desta Comunidade.',
    'permission-denied':
      'Sua participação atual não permite consultar os integrantes desta Comunidade.',
    'failed-precondition':
      'A lista de integrantes não está disponível nas condições atuais.',
    'invalid-argument':
      'Não foi possível validar esta consulta de integrantes.',
    'not-found':
      'Esta Comunidade não está mais disponível.',
    'data-loss':
      'Não foi possível validar o estado atual da Comunidade. Tente novamente.',
  });
