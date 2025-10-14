// functions\src\index.ts
import {onUserCreate} from "./auth/onUserCreate";
import {cleanupOldData} from "./cron/cleanupOldData";
import {moderateContent} from "./moderation/moderateContent";
import {sendNotification} from "./notifications/sendNotification";
import { clearStalePresence } from "./presence/clearStalePresence";
import {onUserCreateIndexNickname} from "./public_index/onUserCreateIndexNickname";

// Exporta todas as funções para o Firebase reconhecer
export {
  onUserCreate,
  moderateContent,
  sendNotification,
  cleanupOldData,
  onUserCreateIndexNickname,
  clearStalePresence,
};
