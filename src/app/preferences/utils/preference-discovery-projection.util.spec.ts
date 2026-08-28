// src/app/preferences/utils/preference-discovery-projection.util.spec.ts
import { describe, expect, it } from 'vitest';

import { createEmptyPreferenceProfile } from './preference-normalizers';
import { buildPreferenceDiscoveryProjection } from './preference-discovery-projection.util';

describe('buildPreferenceDiscoveryProjection', () => {
  it('preserva a seleção privada exata e deduplica categorias canônicas', () => {
    const profile = createEmptyPreferenceProfile('viewer');
    profile.updatedAt = 123;
    profile.hardRules.acceptedGenders = [
      'women',
      'couple_mm',
      'couple_mf',
      'trans_people',
    ];

    const projection = buildPreferenceDiscoveryProjection(profile);

    expect(projection.discoveryPreferences.genderInterests).toEqual([
      'women',
      'couple_mm',
      'couple_mf',
      'trans_people',
    ]);
    expect(projection.discoveryPreferences.updatedAt).toBe(123);
    expect(projection.interestedInGenders).toEqual([
      'woman',
      'couple',
      'trans_woman',
      'trans_man',
      'transgender',
    ]);
  });

  it('projeta idade, distância, intenções e modos de correspondência', () => {
    const profile = createEmptyPreferenceProfile('viewer');
    profile.relationshipIntents = ['dating', 'serious'];
    profile.hardRules.acceptedRelationshipIntents = ['dating', 'serious'];
    profile.hardRules.ageRange = { min: 25, max: 45 };
    profile.hardRules.maxDistanceKm = 30;
    profile.hardRules.locationRequired = true;
    profile.softRules.sexualPractices = ['bdsm'];
    profile.softRules.bodyPreferences = ['tattoos'];
    profile.matchingModes.relationshipIntents = 'prefer';
    profile.matchingModes.sexualPractices = 'require';
    profile.matchingModes.bodyPreferences = 'require';

    const projection = buildPreferenceDiscoveryProjection(profile);

    expect(projection.discoveryPreferences).toEqual(expect.objectContaining({
      relationshipIntents: ['dating', 'serious'],
      ageRange: { min: 25, max: 45 },
      maxDistanceKm: 30,
      locationRequired: true,
      relationshipIntentMode: 'prefer',
      sexualPractices: ['bdsm'],
      sexualPracticeMode: 'require',
      bodyPreferences: ['tattoos'],
      bodyPreferenceMode: 'require',
    }));
  });

  it('não mistura características próprias com características procuradas', () => {
    const profile = createEmptyPreferenceProfile('viewer');
    profile.selfTraits.bodyTraits = ['curvy'];
    profile.softRules.bodyPreferences = ['athletic'];

    const projection = buildPreferenceDiscoveryProjection(profile);

    expect(projection.discoveryPreferences.bodyPreferences).toEqual(['athletic']);
    expect(projection.discoveryPreferences).not.toHaveProperty('bodyTraits');
  });

  it('remove casais da projeção quando o usuário não os aceita', () => {
    const profile = createEmptyPreferenceProfile('viewer');
    profile.hardRules.acceptedGenders = ['women', 'couple_ff'];
    profile.hardRules.acceptsCouples = false;

    const projection = buildPreferenceDiscoveryProjection(profile);

    expect(projection.interestedInGenders).toEqual(['woman']);
    expect(projection.discoveryPreferences.acceptsCouples).toBe(false);
  });

  it('mantém somente casais quando perfis individuais estão desativados', () => {
    const profile = createEmptyPreferenceProfile('viewer');
    profile.hardRules.acceptedGenders = ['men', 'women', 'couple_mf'];
    profile.hardRules.acceptsSingles = false;

    const projection = buildPreferenceDiscoveryProjection(profile);

    expect(projection.interestedInGenders).toEqual(['couple']);
    expect(projection.discoveryPreferences.acceptsSingles).toBe(false);
  });

  it('remove categorias trans canônicas quando há exclusão explícita', () => {
    const profile = createEmptyPreferenceProfile('viewer');
    profile.hardRules.acceptedGenders = [
      'women',
      'travestis',
      'trans_people',
    ];
    profile.hardRules.acceptsTransProfiles = false;

    const projection = buildPreferenceDiscoveryProjection(profile);

    expect(projection.interestedInGenders).toEqual(['woman']);
    expect(projection.discoveryPreferences.acceptsTransProfiles).toBe(false);
  });

  it('mantém projeção inclusiva vazia quando não há seleção explícita', () => {
    const projection = buildPreferenceDiscoveryProjection(
      createEmptyPreferenceProfile('viewer')
    );

    expect(projection.interestedInGenders).toEqual([]);
    expect(projection.discoveryPreferences.genderInterests).toEqual([]);
    expect(projection.discoveryPreferences.relationshipIntents).toEqual([]);
    expect(projection.discoveryPreferences.ageRange).toBeNull();
    expect(projection.discoveryPreferences.maxDistanceKm).toBeNull();
  });
});
