// src/app/preferences/models/match-profile.model.ts
// Documento derivado para discovery/ranking.
// Não é fonte de verdade do perfil.
// É um materializado otimizado para busca, feed e matching.
import {
  DiscoveryMode,
  RelationshipIntent,
  SexualPractice,
} from './preference.types';

export interface MatchProfileSearchData {
  gender: string | null;
  relationshipIntents: RelationshipIntent[];
  sexualPractices: SexualPractice[];

  city: string | null;
  state: string | null;
  geohash: string | null;
  age: number | null;

  availableNow: boolean;
  discoveryMode: DiscoveryMode;

  profileCompleted: boolean;
  emailVerified: boolean;
  isSubscriber: boolean;
}

export interface MatchProfileRankingData {
  responseScore: number;
  trustScore: number;
  activityScore: number;
  compatibilityBoosts: string[];
}

export interface MatchProfile {
  userId: string;
  search: MatchProfileSearchData;
  ranking: MatchProfileRankingData;
  updatedAt: number;
}