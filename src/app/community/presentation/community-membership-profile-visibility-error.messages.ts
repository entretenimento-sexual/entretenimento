// src/app/community/presentation/community-membership-profile-visibility-error.messages.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP PROFILE VISIBILITY - SAFE UX MESSAGES
// -----------------------------------------------------------------------------
// Catálogo específico dos reasons estruturados emitidos pelo backend para a
// visibilidade pública da participação. A interpretação do erro continua no
// ApplicationErrorService; aqui ficam apenas textos seguros de apresentação.
// -----------------------------------------------------------------------------

import type { CommunityErrorMessageMap } from './community-error.messages';

export const COMMUNITY_MEMBERSHIP_PROFILE_VISIBILITY_REASON_MESSAGES:
  CommunityErrorMessageMap = Object.freeze({
    community_settings_manager_required:
      'Somente proprietários e administradores ativos podem alterar esta política.',
    community_membership_profile_visibility_unavailable:
      'Esta Comunidade não permite exibir sua participação no perfil neste momento.',
  });
