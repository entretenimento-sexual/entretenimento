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
    const profile = createEmptyPreferenceProfile('viewer');

    const projection = buildPreferenceDiscoveryProjection(profile);

    expect(projection.interestedInGenders).toEqual([]);
    expect(projection.discoveryPreferences.genderInterests).toEqual([]);
  });
});
