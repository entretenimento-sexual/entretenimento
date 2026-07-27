// src/app/preferences/utils/preference-normalizers.ts
// Normalizadores/defaults do domínio novo.
// Não dependem do legado.
// Servem para criar estado consistente mesmo sem documento salvo.
import type { IntentState } from '../models/intent-state.model';
import type { MatchProfile } from '../models/match-profile.model';
import type {
  PreferenceAgeRange,
  PreferenceProfile,
} from '../models/preference-profile.model';
import type { PreferenceMatchMode } from '../models/preference.types';

const MIN_ALLOWED_AGE = 18;
const MAX_ALLOWED_AGE = 100;
const MAX_DISTANCE_KM = 500;

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
    matchingModes: {
      relationshipIntents: 'require',
      sexualPractices: 'prefer',
      bodyPreferences: 'prefer',
    },
    visibility: {
      showPreferenceBadges: true,
      showIntentPublicly: false,
      discoveryMode: 'standard',
    },
    updatedAt: Date.now(),
  };
}

/**
 * Documentos antigos não possuem matchingModes e podem conter números fora da
 * faixa atual. A normalização evita que a UI e o discovery interpretem valores
 * inconsistentes de maneiras diferentes.
 */
export function normalizePreferenceProfile(
  value: PreferenceProfile | null | undefined,
  userId = ''
): PreferenceProfile {
  const fallback = createEmptyPreferenceProfile(userId);
  const source = value ?? fallback;

  return {
    ...fallback,
    ...source,
    userId: String(source.userId ?? userId).trim() || userId,
    relationshipIntents: uniqueStrings(source.relationshipIntents),
    hardRules: {
      ...fallback.hardRules,
      ...(source.hardRules ?? {}),
      acceptedGenders: uniqueStrings(source.hardRules?.acceptedGenders),
      acceptedRelationshipIntents: uniqueStrings(
        source.hardRules?.acceptedRelationshipIntents ??
          source.relationshipIntents
      ),
      ageRange: normalizeAgeRange(source.hardRules?.ageRange),
      maxDistanceKm: normalizeDistance(source.hardRules?.maxDistanceKm),
      acceptsCouples: source.hardRules?.acceptsCouples !== false,
      acceptsSingles: source.hardRules?.acceptsSingles !== false,
      acceptsTransProfiles:
        source.hardRules?.acceptsTransProfiles === true
          ? true
          : source.hardRules?.acceptsTransProfiles === false
            ? false
            : null,
      locationRequired: source.hardRules?.locationRequired === true,
    },
    softRules: {
      ...fallback.softRules,
      ...(source.softRules ?? {}),
      bodyPreferences: uniqueStrings(source.softRules?.bodyPreferences),
      sexualPractices: uniqueStrings(source.softRules?.sexualPractices),
      vibes: uniqueStrings(source.softRules?.vibes),
      styles: uniqueStrings(source.softRules?.styles),
      interests: uniqueStrings(source.softRules?.interests),
    },
    matchingModes: {
      relationshipIntents: normalizeMatchMode(
        source.matchingModes?.relationshipIntents,
        'require'
      ),
      sexualPractices: normalizeMatchMode(
        source.matchingModes?.sexualPractices,
        'prefer'
      ),
      bodyPreferences: normalizeMatchMode(
        source.matchingModes?.bodyPreferences,
        'prefer'
      ),
    },
    visibility: {
      ...fallback.visibility,
      ...(source.visibility ?? {}),
      showPreferenceBadges:
        source.visibility?.showPreferenceBadges !== false,
      showIntentPublicly: source.visibility?.showIntentPublicly === true,
      discoveryMode: source.visibility?.discoveryMode ?? 'standard',
    },
    updatedAt:
      typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)
        ? source.updatedAt
        : Date.now(),
  } as PreferenceProfile;
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

function normalizeAgeRange(value: unknown): PreferenceAgeRange | null {
  const source = value as Partial<PreferenceAgeRange> | null | undefined;
  const min = normalizeInteger(source?.min, MIN_ALLOWED_AGE, MAX_ALLOWED_AGE);
  const max = normalizeInteger(source?.max, MIN_ALLOWED_AGE, MAX_ALLOWED_AGE);

  if (min === null && max === null) return null;

  const safeMin = min ?? MIN_ALLOWED_AGE;
  const safeMax = max ?? MAX_ALLOWED_AGE;

  return safeMin <= safeMax
    ? { min: safeMin, max: safeMax }
    : { min: safeMax, max: safeMin };
}

function normalizeDistance(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(MAX_DISTANCE_KM, Math.max(1, Math.round(value)));
}

function normalizeInteger(
  value: unknown,
  min: number,
  max: number
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeMatchMode(
  value: unknown,
  fallback: PreferenceMatchMode
): PreferenceMatchMode {
  return value === 'require' || value === 'prefer' ? value : fallback;
}

function uniqueStrings<T extends string>(
  values: readonly T[] | null | undefined
): T[] {
  return Array.from(
    new Set((values ?? []).filter((value): value is T => Boolean(value)))
  );
}
