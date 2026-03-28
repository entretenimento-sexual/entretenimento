// src/app/core/interfaces/preferences/user-match-profile.interface.ts
// Não esquecer comentários explicativos e cosiderar sempre o role do usuário
import { TDiscoveryMode, TPractice, TRelationshipIntent } from './user-preference-enums';

export interface IUserMatchProfile {
  userId: string;

  searchable: {
    gender?: string | null;
    relationshipIntents: TRelationshipIntent[];
    practices: TPractice[];
    city?: string | null;
    state?: string | null;
    geohash?: string | null;
    age?: number | null;
    availableNow: boolean;
    discoveryMode: TDiscoveryMode;
    profileCompleted: boolean;
    emailVerified: boolean;
    isSubscriber?: boolean;
  };

  ranking: {
    responseScore?: number;
    trustScore?: number;
    activityScore?: number;
    compatibilityBoosts?: string[];
  };

  updatedAt: number;
}