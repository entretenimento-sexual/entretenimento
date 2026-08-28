// src/app/preferences/models/user-interaction-metrics.model.ts
// Métricas agregadas de interação do perfil.
// Servem para ranking/discovery, não para fonte canônica do usuário.
export interface UserInteractionMetrics {
  userId: string;

  profileViews7d: number;
  profileViews30d: number;

  profileLikesReceived7d: number;
  profileLikesReceived30d: number;

  photoLikesReceived7d: number;
  photoLikesReceived30d: number;

  swipesRightReceived7d: number;
  swipesRightReceived30d: number;

  matchesCreated7d: number;
  matchesCreated30d: number;

  messagesReceived7d: number;
  messagesReceived30d: number;
  messagesSent7d: number;
  messagesSent30d: number;

  replyRate30d: number; // 0..100
  likeBackRate30d: number; // 0..100

  lastOnlineAt: number | null;
  onlineMinutes7d: number;
  onlineMinutes30d: number;

  updatedAt: number;
}