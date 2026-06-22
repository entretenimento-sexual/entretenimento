// functions/src/index.ts
import { onUserCreate } from './auth/onUserCreate';
import { cleanupOldData } from './cron/cleanupOldData';
import { moderateContent } from './moderation/moderateContent';
import { sendNotification } from './notifications/sendNotification';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications/read-status';
import { clearStalePresence } from './presence/clearStalePresence';
import { onUserCreateIndexNickname } from './public_index/onUserCreateIndexNickname';

export {
  onUserCreate,
  moderateContent,
  sendNotification,
  markNotificationRead,
  markAllNotificationsRead,
  cleanupOldData,
  onUserCreateIndexNickname,
  clearStalePresence,
};
export * from './payments';
export * from './account_lifecycle';
export * from './chat';
export * from './compliance';
export * from './discovery';
export * from './friendship';
export * from './media';
