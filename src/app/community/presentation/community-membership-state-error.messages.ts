// src/app/community/presentation/community-membership-state-error.messages.ts
import type { CommunityErrorMessageMap } from './community-error.messages';

/**
 * Mensagem segura para falhas fechadas quando existe um documento de membership,
 * mas o estado persistido não corresponde a nenhum status suportado pelo domínio.
 * As superfícies continuam livres para usar o fallback do código
 * `failed-precondition`; este catálogo impede exposição do reason bruto e mantém o
 * contrato backend/frontend explícito.
 */
export const COMMUNITY_MEMBERSHIP_STATE_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    membership_status_invalid:
      'Não foi possível validar o estado da participação nesta Comunidade. Tente novamente.',
  });
