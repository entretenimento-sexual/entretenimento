// src/app/preferences/utils/preference-profile-form.factory.ts
// Fábrica + mapper do formulário de PreferenceProfile.
//
// Objetivo:
// - tirar do componente visual a montagem do form
// - tirar do componente visual a serialização/deserialização do model
// - manter as regras em um ponto só

import {
  AbstractControl,
  FormBuilder,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import {
  BODY_PREFERENCE_OPTIONS,
  DISCOVERY_MODE_OPTIONS,
  GENDER_INTEREST_OPTIONS,
  RELATIONSHIP_INTENT_OPTIONS,
  SEXUAL_PRACTICE_OPTIONS,
  PreferenceOption,
} from '../catalogs/preference-profile-options.catalog';
import type { PreferenceProfile } from '../models/preference-profile.model';
import type {
  DiscoveryMode,
  PreferenceMatchMode,
} from '../models/preference.types';
import type { PreferencesCapabilitySnapshot } from '../services/preferences-capability.service';

type AcceptsTransProfilesFormValue = 'all' | 'yes' | 'no';
type RawFormValue = Record<string, unknown>;

const MIN_ALLOWED_AGE = 18;
const MAX_ALLOWED_AGE = 100;

export function buildPreferenceProfileForm(fb: FormBuilder) {
  return fb.group(
    {
      minAge: fb.control<number | null>(null, [
        Validators.min(MIN_ALLOWED_AGE),
        Validators.max(MAX_ALLOWED_AGE),
      ]),
      maxAge: fb.control<number | null>(null, [
        Validators.min(MIN_ALLOWED_AGE),
        Validators.max(MAX_ALLOWED_AGE),
      ]),
      maxDistanceKm: fb.control<number | null>(null, [
        Validators.min(1),
        Validators.max(500),
      ]),

      relationshipIntentMode:
        fb.nonNullable.control<PreferenceMatchMode>('require'),
      sexualPracticeMode:
        fb.nonNullable.control<PreferenceMatchMode>('prefer'),
      bodyPreferenceMode:
        fb.nonNullable.control<PreferenceMatchMode>('prefer'),

      acceptsCouples: fb.nonNullable.control(true),
      acceptsSingles: fb.nonNullable.control(true),
      acceptsTransProfiles:
        fb.nonNullable.control<AcceptsTransProfilesFormValue>('all'),
      locationRequired: fb.nonNullable.control(false),

      showPreferenceBadges: fb.nonNullable.control(true),
      showIntentPublicly: fb.nonNullable.control(false),
      discoveryMode: fb.nonNullable.control<DiscoveryMode>('standard'),

      ...buildFlagControls(fb, 'ri', RELATIONSHIP_INTENT_OPTIONS),
      ...buildFlagControls(fb, 'gi', GENDER_INTEREST_OPTIONS),
      ...buildFlagControls(fb, 'sp', SEXUAL_PRACTICE_OPTIONS),
      ...buildFlagControls(fb, 'bp', BODY_PREFERENCE_OPTIONS),
    },
    { validators: ageRangeValidator() }
  );
}

export function mapPreferenceProfileToFormValue(
  profile: PreferenceProfile
): RawFormValue {
  return {
    minAge: profile.hardRules.ageRange?.min ?? null,
    maxAge: profile.hardRules.ageRange?.max ?? null,
    maxDistanceKm: profile.hardRules.maxDistanceKm,

    relationshipIntentMode:
      profile.matchingModes?.relationshipIntents ?? 'require',
    sexualPracticeMode:
      profile.matchingModes?.sexualPractices ?? 'prefer',
    bodyPreferenceMode:
      profile.matchingModes?.bodyPreferences ?? 'prefer',

    acceptsCouples: profile.hardRules.acceptsCouples,
    acceptsSingles: profile.hardRules.acceptsSingles,
    acceptsTransProfiles: writeAcceptsTransProfiles(
      profile.hardRules.acceptsTransProfiles
    ),
    locationRequired: profile.hardRules.locationRequired,

    showPreferenceBadges: profile.visibility.showPreferenceBadges,
    showIntentPublicly: profile.visibility.showIntentPublicly,
    discoveryMode: profile.visibility.discoveryMode,

    ...buildFlagPatch(
      profile.relationshipIntents,
      'ri',
      RELATIONSHIP_INTENT_OPTIONS
    ),
    ...buildFlagPatch(
      profile.hardRules.acceptedGenders,
      'gi',
      GENDER_INTEREST_OPTIONS
    ),
    ...buildFlagPatch(
      profile.softRules.sexualPractices,
      'sp',
      SEXUAL_PRACTICE_OPTIONS
    ),
    ...buildFlagPatch(
      profile.softRules.bodyPreferences,
      'bp',
      BODY_PREFERENCE_OPTIONS
    ),
  };
}

export function mapFormValueToPreferenceProfile(
  raw: RawFormValue,
  current: PreferenceProfile,
  capabilities: PreferencesCapabilitySnapshot | null | undefined
): PreferenceProfile {
  const canEditAdvanced =
    capabilities?.canEditAdvancedPreferences === true;
  const canRequireAdvanced =
    capabilities?.canRequireAdvancedPreferences === true;
  const relationshipIntents = collectSelected(
    raw,
    'ri',
    RELATIONSHIP_INTENT_OPTIONS
  );

  return {
    ...current,
    relationshipIntents,
    hardRules: {
      ...current.hardRules,
      acceptedGenders: collectSelected(raw, 'gi', GENDER_INTEREST_OPTIONS),
      acceptedRelationshipIntents: relationshipIntents,
      ageRange: readAgeRange(raw['minAge'], raw['maxAge']),
      maxDistanceKm: readNullableNumber(raw['maxDistanceKm'], 1, 500),
      acceptsCouples: raw['acceptsCouples'] === true,
      acceptsSingles: raw['acceptsSingles'] === true,
      acceptsTransProfiles: readAcceptsTransProfiles(
        raw['acceptsTransProfiles']
      ),
      locationRequired: raw['locationRequired'] === true,
    },
    softRules: {
      ...current.softRules,
      // Campos pagos nunca são alterados por um cliente sem entitlement válido.
      // Ao salvar preferências essenciais, seleções avançadas já existentes são
      // preservadas, mas permanecem indisponíveis para edição/uso pela UI.
      bodyPreferences: canEditAdvanced
        ? collectSelected(raw, 'bp', BODY_PREFERENCE_OPTIONS)
        : current.softRules.bodyPreferences ?? [],
      sexualPractices: canEditAdvanced
        ? collectSelected(raw, 'sp', SEXUAL_PRACTICE_OPTIONS)
        : current.softRules.sexualPractices ?? [],
      vibes: current.softRules.vibes ?? [],
      styles: current.softRules.styles ?? [],
      interests: current.softRules.interests ?? [],
    },
    matchingModes: {
      relationshipIntents: readMatchMode(
        raw['relationshipIntentMode'],
        'require'
      ),
      sexualPractices: canEditAdvanced
        ? normalizeAdvancedMode(raw['sexualPracticeMode'], canRequireAdvanced)
        : current.matchingModes?.sexualPractices ?? 'prefer',
      bodyPreferences: canEditAdvanced
        ? normalizeAdvancedMode(raw['bodyPreferenceMode'], canRequireAdvanced)
        : current.matchingModes?.bodyPreferences ?? 'prefer',
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

export function ageRangeValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const min = readNullableNumber(control.get('minAge')?.value, 18, 100);
    const max = readNullableNumber(control.get('maxAge')?.value, 18, 100);

    if (min === null || max === null) return null;
    return min <= max ? null : { ageRangeOrder: true };
  };
}

function buildFlagControls<T extends string>(
  fb: FormBuilder,
  prefix: string,
  options: ReadonlyArray<PreferenceOption<T>>
): Record<string, ReturnType<FormBuilder['nonNullable']['control']>> {
  return options.reduce<
    Record<string, ReturnType<FormBuilder['nonNullable']['control']>>
  >((acc, option) => {
    acc[`${prefix}_${option.key}`] = fb.nonNullable.control(false);
    return acc;
  }, {});
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

function readAgeRange(
  minValue: unknown,
  maxValue: unknown
): PreferenceProfile['hardRules']['ageRange'] {
  const min = readNullableNumber(minValue, MIN_ALLOWED_AGE, MAX_ALLOWED_AGE);
  const max = readNullableNumber(maxValue, MIN_ALLOWED_AGE, MAX_ALLOWED_AGE);

  if (min === null && max === null) return null;

  return {
    min: min ?? MIN_ALLOWED_AGE,
    max: max ?? MAX_ALLOWED_AGE,
  };
}

function readNullableNumber(
  value: unknown,
  min?: number,
  max?: number
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  let normalized = Math.round(value);
  if (typeof min === 'number') normalized = Math.max(min, normalized);
  if (typeof max === 'number') normalized = Math.min(max, normalized);
  return normalized;
}

function readAcceptsTransProfiles(value: unknown): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

function writeAcceptsTransProfiles(
  value: boolean | null | undefined
): AcceptsTransProfilesFormValue {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'all';
}

function readMatchMode(
  value: unknown,
  fallback: PreferenceMatchMode
): PreferenceMatchMode {
  return value === 'prefer' || value === 'require' ? value : fallback;
}

function normalizeAdvancedMode(
  value: unknown,
  canRequireAdvanced: boolean
): PreferenceMatchMode {
  return value === 'require' && canRequireAdvanced ? 'require' : 'prefer';
}

function normalizeDiscoveryMode(
  mode: DiscoveryMode,
  capabilities: PreferencesCapabilitySnapshot | null | undefined
): DiscoveryMode {
  if (
    mode === 'priority' &&
    !(capabilities?.canUsePriorityVisibility ?? false)
  ) {
    return 'standard';
  }

  if (
    mode === 'discreet' &&
    !(capabilities?.canUseDiscreetMode ?? false)
  ) {
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
