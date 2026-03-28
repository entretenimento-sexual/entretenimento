// src/app/core/interfaces/preferences/user-preference-profile.interface.ts
// Não esquecer comentários explicativos e cosiderar sempre o role do usuário
import {
  TBodyType,
  TDiscoveryMode,
  TGenderInterest,
  TPractice,
  TRelationshipIntent,
} from './user-preference-enums';

export interface IUserHardConstraints {
  acceptedGenders: TGenderInterest[];
  acceptedRelationshipIntents: TRelationshipIntent[];
  ageRange?: {
    min: number;
    max: number;
  } | null;
  maxDistanceKm?: number | null;
  acceptsCouples?: boolean;
  acceptsSingles?: boolean;
  acceptsTransProfiles?: boolean | null;
  locationRequired?: boolean;
}

export interface IUserSoftPreferences {
  bodyTypes: TBodyType[];
  practices: TPractice[];
  vibes: string[];
  styles: string[];
  interests: string[];
}

export interface IUserPreferenceVisibility {
  showPreferenceBadges: boolean;
  showIntentPublicly: boolean;
  discoveryMode: TDiscoveryMode;
}

export interface IUserPreferenceProfile {
  userId: string;

  relationshipIntent: TRelationshipIntent[];

  hardConstraints: IUserHardConstraints;
  softPreferences: IUserSoftPreferences;
  visibility: IUserPreferenceVisibility;

  updatedAt: number;
}