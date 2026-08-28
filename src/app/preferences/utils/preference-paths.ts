// src/app/preferences/utils/preference-paths.ts
// Paths centralizados do domínio de preferências.
// Evita string solta em múltiplos services.
// src/app/preferences/utils/preference-paths.ts
export const preferencePaths = {
  profile: (uid: string) => `users/${uid}/preferences/profile`,
  intent: (uid: string) => `users/${uid}/preferences/intent`,
  publicProfile: (uid: string) => `public_user_preferences/${uid}`,
  matchProfile: (uid: string) => `match_profiles/${uid}`,

  interactionMetrics: (uid: string) => `user_interaction_metrics/${uid}`,
  reputationMetrics: (uid: string) => `user_reputation_metrics/${uid}`,

  discoveryHistoryEntry: (viewerUid: string, targetUid: string) =>
    `discovery_history/${viewerUid}/seen/${targetUid}`,

  swipeEdge: (viewerUid: string, targetUid: string) =>
    `swipe_edges/${viewerUid}/targets/${targetUid}`,

  matchEdge: (pairId: string) => `matches/${pairId}`,

  compatibilityCacheEntry: (viewerUid: string, targetUid: string) =>
    `compatibility_cache/${viewerUid}/targets/${targetUid}`,

  discoveryQueueItem: (viewerUid: string, targetUid: string) =>
    `discovery_queue/${viewerUid}/items/${targetUid}`,
} as const;