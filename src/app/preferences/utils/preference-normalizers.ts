// src/app/preferences/utils/preference-normalizers.ts
// Normalizadores/defaults do domínio novo.
// Não dependem do legado.
// Servem para criar estado consistente mesmo sem documento salvo.
import { IntentState } from '../models/intent-state.model';
import { MatchProfile } from '../models/match-profile.model';
import { PreferenceProfile } from '../models/preference-profile.model';

export function createEmptyPreferenceProfile(userId: string): PreferenceProfile {
  return {
    userId,
    relationshipIntents: [],
    hardRules: {
      acceptedGenders: [],
      acceptedRelationshipIntents: [],
      ageRange: null,
      maxDistanceKm: null,
      acceptsCouples: true,
      acceptsSingles: true,
      acceptsTransProfiles: null,
      locationRequired: false,
    },
    softRules: {
      bodyPreferences: [],
      sexualPractices: [],
      vibes: [],
      styles: [],
      interests: [],
    },
    visibility: {
      showPreferenceBadges: true,
      showIntentPublicly: false,
      discoveryMode: 'standard',
    },
    updatedAt: Date.now(),
  };
}

export function createEmptyIntentState(userId: string): IntentState {
  return {
    userId,
    mode: 'inactive',
    availableNow: false,
    availableToday: false,
    tags: [],
    cityOverride: null,
    expiresAt: null,
    updatedAt: Date.now(),
  };
}

export function createEmptyMatchProfile(userId: string): MatchProfile {
  return {
    userId,
    search: {
      gender: null,
      relationshipIntents: [],
      sexualPractices: [],
      city: null,
      state: null,
      geohash: null,
      age: null,
      availableNow: false,
      discoveryMode: 'standard',
      profileCompleted: false,
      emailVerified: false,
      isSubscriber: false,
    },
    ranking: {
      responseScore: 0,
      trustScore: 0,
      activityScore: 0,
      compatibilityBoosts: [],
    },
    updatedAt: Date.now(),
  };
}