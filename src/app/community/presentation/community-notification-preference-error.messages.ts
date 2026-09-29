// src/app/community/presentation/community-notification-preference-error.messages.ts
import type { CommunityErrorMessageMap } from './community-error.messages';

export const COMMUNITY_NOTIFICATION_PREFERENCE_REASON_MESSAGES: CommunityErrorMessageMap =
  Object.freeze({
    invalid_community_notification_preference:
      'Não foi possível validar esta preferência de notificações.',
    active_membership_required:
      'Participe da Comunidade para alterar estas notificações.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
  });

