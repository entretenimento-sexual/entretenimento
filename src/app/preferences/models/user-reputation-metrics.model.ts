// src/app/preferences/models/user-reputation-metrics.model.ts
// Métricas de confiança/reputação.
// Não substituem moderação; ajudam no ranking e na proteção do discovery.
export interface UserReputationMetrics {
  userId: string;

  emailVerified: boolean;
  photoVerified: boolean;
  profileCompleted: boolean;

  reportsReceived7d: number;
  reportsReceived30d: number;

  blocksReceived7d: number;
  blocksReceived30d: number;

  moderationFlags7d: number;
  moderationFlags30d: number;

  trustScore: number; // 0..100
  safetyScore: number; // 0..100

  updatedAt: number;
}