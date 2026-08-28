// src/app/preferences/utils/preference-normalizers.spec.ts
import { describe, expect, it } from 'vitest';

import type { PreferenceProfile } from '../models/preference-profile.model';
import {
  createEmptyPreferenceProfile,
  normalizePreferenceProfile,
} from './preference-normalizers';

describe('normalizePreferenceProfile', () => {
  it('cria defaults seguros para o novo contrato', () => {
    const profile = createEmptyPreferenceProfile('owner');

    expect(profile.selfTraits.bodyTraits).toEqual([]);
    expect(profile.matchingModes).toEqual({
      relationshipIntents: 'require',
      sexualPractices: 'prefer',
      bodyPreferences: 'prefer',
    });
    expect(profile.hardRules.ageRange).toBeNull();
    expect(profile.hardRules.maxDistanceKm).toBeNull();
  });

  it('migra em memória documento legado sem apagar seleções', () => {
    const legacy = {
      userId: 'owner',
      relationshipIntents: ['dating'],
      hardRules: {
        acceptedGenders: ['women'],
        acceptedRelationshipIntents: ['dating'],
        ageRange: { min: 45, max: 25 },
        maxDistanceKm: 999,
        acceptsCouples: true,
        acceptsSingles: true,
        acceptsTransProfiles: null,
        locationRequired: false,
      },
      softRules: {
        bodyPreferences: ['athletic'],
        sexualPractices: ['bdsm'],
        vibes: [],
        styles: [],
        interests: [],
      },
      visibility: {
        showPreferenceBadges: true,
        showIntentPublicly: false,
        discoveryMode: 'standard',
      },
      updatedAt: 123,
    } as unknown as PreferenceProfile;

    const normalized = normalizePreferenceProfile(legacy, 'owner');

    expect(normalized.relationshipIntents).toEqual(['dating']);
    expect(normalized.softRules.bodyPreferences).toEqual(['athletic']);
    expect(normalized.softRules.sexualPractices).toEqual(['bdsm']);
    expect(normalized.selfTraits.bodyTraits).toEqual([]);
    expect(normalized.matchingModes.relationshipIntents).toBe('require');
    expect(normalized.hardRules.ageRange).toEqual({ min: 25, max: 45 });
    expect(normalized.hardRules.maxDistanceKm).toBe(500);
  });

  it('deduplica listas e normaliza modos inválidos', () => {
    const profile = createEmptyPreferenceProfile('owner');
    profile.relationshipIntents = ['dating', 'dating'];
    profile.selfTraits.bodyTraits = ['tattoos', 'tattoos'];
    profile.matchingModes.sexualPractices = 'invalid' as never;

    const normalized = normalizePreferenceProfile(profile, 'owner');

    expect(normalized.relationshipIntents).toEqual(['dating']);
    expect(normalized.selfTraits.bodyTraits).toEqual(['tattoos']);
    expect(normalized.matchingModes.sexualPractices).toBe('prefer');
  });
});
