// functions/src/index.ts
import { onUserCreate } from './auth/onUserCreate';
import { recoverRegistrationSeed } from './auth/recoverRegistrationSeed';
import { cleanupOldData } from './cron/cleanupOldData';
import { moderateContent } from './moderation/moderateContent';
import {
  registerPushDevice,
  unregisterPushDevice,
} from './notifications/push-device-registry';
import { sendNotification } from './notifications/sendNotification';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications/read-status';
import { clearStalePresence } from './presence/clearStalePresence';
import { onUserCreateIndexNickname } from './public_index/onUserCreateIndexNickname';

export {
  onUserCreate,
  recoverRegistrationSeed,
  moderateContent,
  sendNotification,
  registerPushDevice,
  unregisterPushDevice,
  markNotificationRead,
  markAllNotificationsRead,
  cleanupOldData,
  onUserCreateIndexNickname,
  clearStalePresence,
};
export {
  getCommunityOwnershipCandidatesPage,
} from './community/get-community-ownership-candidates-page.handler';
export {
  reconcileCommunityMemberCounts,
} from './community/reconcile-community-member-counts.handler';
export * from './payments';
export * from './business-official';
export * from './community-boost';
export * from './account_lifecycle';
export * from './chat';
export * from './community';
export {
  issueEventAuthority,
  revokeEventAuthority,
} from './authority/event-authority.handler';
export * from './compliance';
export * from './discovery';
export * from './friendship';
export * from './media';
export * from './subscriber-experiences';
