// functions\src\index.ts
import {onUserCreate} from "./auth/onUserCreate";
import {cleanupOldData} from "./cron/cleanupOldData";
import {moderateContent} from "./moderation/moderateContent";
import {sendNotification} from "./notifications/sendNotification";

// Exporta todas as funções para o Firebase reconhecer
export {
  onUserCreate,
  moderateContent,
  sendNotification,
  cleanupOldData,
};
