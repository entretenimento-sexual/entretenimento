// src/app/core/utils/preferences/preference-normalizers.ts
import { IUserIntentState } from '@core/interfaces/preferences/user-intent-state.interface';
import { IUserPreferenceProfile } from '@core/interfaces/preferences/user-preference-profile.interface';

export function createEmptyPreferenceProfile(userId: string): IUserPreferenceProfile {
  return {
    userId,
    relationshipIntent: [],
    hardConstraints: {
      acceptedGenders: [],
      acceptedRelationshipIntents: [],
      ageRange: null,
      maxDistanceKm: null,
      acceptsCouples: true,
      acceptsSingles: true,
      acceptsTransProfiles: null,
      locationRequired: false,
    },
    softPreferences: {
      bodyTypes: [],
      practices: [],
      vibes: [],
      styles: [],
      interests: [],
    },
    visibility: {
      showPreferenceBadges: true,
      showIntentPublicly: false,
      discoveryMode: 'normal',
    },
    updatedAt: Date.now(),
  };
}

export function createEmptyIntentState(userId: string): IUserIntentState {
  return {
    userId,
    currentMode: 'inactive',
    availableNow: false,
    availableToday: false,
    contextTags: [],
    cityOverride: null,
    expiresAt: null,
    updatedAt: Date.now(),
  };
}