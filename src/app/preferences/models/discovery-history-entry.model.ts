// src/app/preferences/models/discovery-history-entry.model.ts
// Histórico por viewer para rotação e anti-repetição.

export interface DiscoveryHistoryEntry {
  viewerUid: string;
  targetUid: string;

  firstSeenAt: number | null;
  lastSeenAt: number | null;

  impressions7d: number;
  impressions30d: number;

  lastAction: 'none' | 'like' | 'pass' | 'super_like' | 'maybe';
  lastActionAt: number | null;

  timesPassed: number;
  timesLiked: number;

  updatedAt: number;
}