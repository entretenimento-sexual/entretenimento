// src/app/preferences/models/discovery-candidate.model.ts
// Shape final pronto para surfaces de discovery.
// Pode ser construído on-demand ou materializado depois.
import { DiscoveryMode } from './preference.types';

export interface DiscoveryCandidate {
  viewerUid: string;
  targetUid: string;

  eligibilityPassed: boolean;
  hiddenReason: string | null;

  mutualCompatibilityScore: number;
  profileQualityScore: number;
  engagementScore: number;
  activityScore: number;
  trustScore: number;
  freshnessScore: number;

  monetizationBoost: number; // capado
  rotationPenalty: number;
  explorationBoost: number;

  finalRankingScore: number;

  targetDiscoveryMode: DiscoveryMode | null;
  targetAvailableNow: boolean;

  lastSeenAt: number | null;
  impressions7d: number;
  wasLikedByViewer: boolean;
  wasPassedByViewer: boolean;

  generatedAt: number;
}