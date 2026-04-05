// src/app/preferences/utils/preference-profile-form.factory.ts
// Fábrica + mapper do formulário de PreferenceProfile.
//
// Objetivo:
// - tirar do componente visual a montagem do form
// - tirar do componente visual a serialização/deserialização do model
// - manter as regras em um ponto só

import { FormBuilder } from '@angular/forms';

import {
  BODY_PREFERENCE_OPTIONS,
  DISCOVERY_MODE_OPTIONS,
  GENDER_INTEREST_OPTIONS,
  RELATIONSHIP_INTENT_OPTIONS,
  SEXUAL_PRACTICE_OPTIONS,
  PreferenceOption,
} from '../catalogs/preference-profile-options.catalog';
import { PreferenceProfile } from '../models/preference-profile.model';
import { DiscoveryMode } from '../models/preference.types';
import { PreferencesCapabilitySnapshot } from '../services/preferences-capability.service';

type AcceptsTransProfilesFormValue = 'all' | 'yes' | 'no';
type RawFormValue = Record<string, unknown>;

export function buildPreferenceProfileForm(fb: FormBuilder) {
  return fb.group({
    maxDistanceKm: fb.control<number | null>(null),

    acceptsCouples: fb.nonNullable.control(true),
    acceptsSingles: fb.nonNullable.control(true),
    acceptsTransProfiles: fb.nonNullable.control<AcceptsTransProfilesFormValue>('all'),
    locationRequired: fb.nonNullable.control(false),

    showPreferenceBadges: fb.nonNullable.control(true),
    showIntentPublicly: fb.nonNullable.control(false),
    discoveryMode: fb.nonNullable.control<DiscoveryMode>('standard'),

    ...buildFlagControls(fb, 'ri', RELATIONSHIP_INTENT_OPTIONS),
    ...buildFlagControls(fb, 'gi', GENDER_INTEREST_OPTIONS),
    ...buildFlagControls(fb, 'sp', SEXUAL_PRACTICE_OPTIONS),
    ...buildFlagControls(fb, 'bp', BODY_PREFERENCE_OPTIONS),
  });
}

export function mapPreferenceProfileToFormValue(profile: PreferenceProfile): RawFormValue {
  return {
    maxDistanceKm: profile.hardRules.maxDistanceKm,
    acceptsCouples: profile.hardRules.acceptsCouples,
    acceptsSingles: profile.hardRules.acceptsSingles,
    acceptsTransProfiles: writeAcceptsTransProfiles(profile.hardRules.acceptsTransProfiles),
    locationRequired: profile.hardRules.locationRequired,

    showPreferenceBadges: profile.visibility.showPreferenceBadges,
    showIntentPublicly: profile.visibility.showIntentPublicly,
    discoveryMode: profile.visibility.discoveryMode,

    ...buildFlagPatch(profile.relationshipIntents, 'ri', RELATIONSHIP_INTENT_OPTIONS),
    ...buildFlagPatch(profile.hardRules.acceptedGenders, 'gi', GENDER_INTEREST_OPTIONS),
    ...buildFlagPatch(profile.softRules.sexualPractices, 'sp', SEXUAL_PRACTICE_OPTIONS),
    ...buildFlagPatch(profile.softRules.bodyPreferences, 'bp', BODY_PREFERENCE_OPTIONS),
  };
}

export function mapFormValueToPreferenceProfile(
  raw: RawFormValue,
  current: PreferenceProfile,
  capabilities: PreferencesCapabilitySnapshot | null | undefined
): PreferenceProfile {
  return {
    ...current,
    relationshipIntents: collectSelected(raw, 'ri', RELATIONSHIP_INTENT_OPTIONS),
    hardRules: {
      ...current.hardRules,
      acceptedGenders: collectSelected(raw, 'gi', GENDER_INTEREST_OPTIONS),
      acceptedRelationshipIntents: collectSelected(raw, 'ri', RELATIONSHIP_INTENT_OPTIONS),
      ageRange: current.hardRules.ageRange ?? null,
      maxDistanceKm: readNullableNumber(raw['maxDistanceKm']),
      acceptsCouples: raw['acceptsCouples'] === true,
      acceptsSingles: raw['acceptsSingles'] === true,
      acceptsTransProfiles: readAcceptsTransProfiles(raw['acceptsTransProfiles']),
      locationRequired: raw['locationRequired'] === true,
    },
    softRules: {
      ...current.softRules,
      bodyPreferences: collectSelected(raw, 'bp', BODY_PREFERENCE_OPTIONS),
      sexualPractices: collectSelected(raw, 'sp', SEXUAL_PRACTICE_OPTIONS),
      vibes: current.softRules.vibes ?? [],
      styles: current.softRules.styles ?? [],
      interests: current.softRules.interests ?? [],
    },
    visibility: {
      showPreferenceBadges: raw['showPreferenceBadges'] === true,
      showIntentPublicly: raw['showIntentPublicly'] === true,
      discoveryMode: normalizeDiscoveryMode(
        (raw['discoveryMode'] as DiscoveryMode) ?? 'standard',
        capabilities
      ),
    },
    updatedAt: Date.now(),
  };
}

function buildFlagControls<T extends string>(
  fb: FormBuilder,
  prefix: string,
  options: ReadonlyArray<PreferenceOption<T>>
): Record<string, ReturnType<FormBuilder['nonNullable']['control']>> {
  return options.reduce<Record<string, ReturnType<FormBuilder['nonNullable']['control']>>>(
    (acc, option) => {
      acc[`${prefix}_${option.key}`] = fb.nonNullable.control(false);
      return acc;
    },
    {}
  );
}

function buildFlagPatch<T extends string>(
  selected: readonly T[] | null | undefined,
  prefix: string,
  options: ReadonlyArray<PreferenceOption<T>>
): Record<string, boolean> {
  const set = new Set((selected ?? []).filter(Boolean));

  return options.reduce<Record<string, boolean>>((acc, option) => {
    acc[`${prefix}_${option.key}`] = set.has(option.key);
    return acc;
  }, {});
}

function collectSelected<T extends string>(
  raw: RawFormValue,
  prefix: string,
  options: ReadonlyArray<PreferenceOption<T>>
): T[] {
  return options
    .filter((option) => raw[`${prefix}_${option.key}`] === true)
    .map((option) => option.key);
}

function readNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function readAcceptsTransProfiles(value: unknown): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

function writeAcceptsTransProfiles(value: boolean | null | undefined): AcceptsTransProfilesFormValue {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'all';
}

function normalizeDiscoveryMode(
  mode: DiscoveryMode,
  capabilities: PreferencesCapabilitySnapshot | null | undefined
): DiscoveryMode {
  if (mode === 'priority' && !(capabilities?.canUsePriorityVisibility ?? false)) {
    return 'standard';
  }

  if (mode === 'discreet' && !(capabilities?.canUseDiscreetMode ?? false)) {
    return 'standard';
  }

  return mode;
}

export {
  RELATIONSHIP_INTENT_OPTIONS,
  GENDER_INTEREST_OPTIONS,
  SEXUAL_PRACTICE_OPTIONS,
  BODY_PREFERENCE_OPTIONS,
  DISCOVERY_MODE_OPTIONS,
};