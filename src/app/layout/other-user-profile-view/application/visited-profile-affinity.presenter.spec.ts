import { describe, expect, it, vi } from 'vitest';

import { VisitedProfileAffinityPresenter } from './visited-profile-affinity.presenter';

describe('VisitedProfileAffinityPresenter', () => {
  function setup(viewer: any) {
    return new VisitedProfileAffinityPresenter({
      getSnapshot: vi.fn(() => viewer),
    } as any);
  }

  it('oculta chips quando o perfil não autorizou badges públicos', () => {
    const presenter = setup({ uid: 'viewer' });

    const vm = presenter.build({
      uid: 'target',
      preferenceBadgesVisible: false,
      publicRelationshipIntents: ['serious'],
    } as any);

    expect(vm.preferenceChips).toEqual([]);
  });

  it('sanitiza e limita chips públicos a oito rótulos sem duplicação', () => {
    const presenter = setup({ uid: 'viewer' });

    const vm = presenter.build({
      uid: 'target',
      preferenceBadgesVisible: true,
      publicRelationshipIntents: ['serious', 'casual', 'serious'],
      publicBodyTraits: ['tattoos', 'piercings', 'athletic', 'curvy'],
      publicSexualPractices: ['bdsm', 'voyeurism', 'roleplay', 'swing'],
    } as any);

    expect(vm.preferenceChips.length).toBeLessThanOrEqual(8);
    expect(new Set(vm.preferenceChips).size).toBe(vm.preferenceChips.length);
    expect(vm.preferenceChips).toContain('Sério');
  });

  it('não gera desireMatch para perfil próprio', () => {
    const presenter = setup({ uid: 'same' });

    const vm = presenter.build({ uid: 'same' } as any);

    expect(vm.desireMatch).toBeNull();
  });

  it('projeta desireMatch sem expor score bruto', () => {
    const presenter = setup({
      uid: 'viewer',
      discoveryPreferences: {
        relationshipIntents: ['serious'],
        relationshipIntentMode: 'prefer',
        sexualPractices: ['bdsm'],
        sexualPracticeMode: 'prefer',
        bodyPreferences: ['tattoos'],
        bodyPreferenceMode: 'prefer',
        genderInterests: [],
        acceptsCouples: true,
        acceptsSingles: true,
        acceptsTransProfiles: null,
        ageRange: null,
        maxDistanceKm: null,
        locationRequired: false,
        updatedAt: 1,
      },
    });

    const vm = presenter.build({
      uid: 'target',
      relationshipIntents: ['serious'],
      sexualPractices: ['bdsm'],
      bodyTraits: ['tattoos'],
      profileType: 'single',
      gender: 'female',
      idade: 30,
    } as any);

    if (vm.desireMatch) {
      expect(vm.desireMatch.title).toMatch(/Desejos/u);
      expect(vm.desireMatch.labels).not.toContain('0.75');
    }
  });
});
