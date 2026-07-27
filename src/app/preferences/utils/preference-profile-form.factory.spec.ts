// src/app/preferences/utils/preference-profile-form.factory.spec.ts
import { describe, expect, it } from 'vitest';

import type { PreferencesCapabilitySnapshot } from '../services/preferences-capability.service';
import { createEmptyPreferenceProfile } from './preference-normalizers';
import {
  ageRangeValidator,
  mapFormValueToPreferenceProfile,
  mapPreferenceProfileToFormValue,
} from './preference-profile-form.factory';

function capabilities(
  patch: Partial<PreferencesCapabilitySnapshot> = {}
): PreferencesCapabilitySnapshot {
  return {
    currentPlan: 'free',
    currentPlanLabel: 'Gratuito',
    hasActiveSubscription: false,
    canEditCorePreferences: true,
    canEditIntentState: true,
    canEditAdvancedPreferences: false,
    canRequireAdvancedPreferences: false,
    canUseContextualIntent: false,
    canUseAdvancedDiscovery: false,
    canUseDiscreetMode: false,
    canUsePriorityVisibility: false,
    canUseIntentBoost: false,
    canSeeCompatibilityInsights: false,
    ...patch,
  };
}

describe('preference-profile-form.factory', () => {
  it('preserva preferências pagas existentes ao salvar campos essenciais sem plano', () => {
    const current = createEmptyPreferenceProfile('owner');
    current.softRules.bodyPreferences = ['athletic'];
    current.softRules.sexualPractices = ['bdsm'];

    const raw = mapPreferenceProfileToFormValue(current);
    raw['bp_athletic'] = false;
    raw['bp_curvy'] = true;
    raw['sp_bdsm'] = false;
    raw['sp_tantra'] = true;

    const result = mapFormValueToPreferenceProfile(
      raw,
      current,
      capabilities()
    );

    expect(result.softRules.bodyPreferences).toEqual(['athletic']);
    expect(result.softRules.sexualPractices).toEqual(['bdsm']);
  });

  it('permite autodescrição e filtros essenciais no plano gratuito', () => {
    const current = createEmptyPreferenceProfile('owner');
    const raw = mapPreferenceProfileToFormValue(current);
    raw['st_tattoos'] = true;
    raw['minAge'] = 25;
    raw['maxAge'] = 45;
    raw['maxDistanceKm'] = 30;
    raw['relationshipIntentMode'] = 'require';

    const result = mapFormValueToPreferenceProfile(
      raw,
      current,
      capabilities()
    );

    expect(result.selfTraits.bodyTraits).toEqual(['tattoos']);
    expect(result.hardRules.ageRange).toEqual({ min: 25, max: 45 });
    expect(result.hardRules.maxDistanceKm).toBe(30);
    expect(result.matchingModes.relationshipIntents).toBe('require');
  });

  it('Básico altera preferências avançadas, mas normaliza exigir para preferir', () => {
    const current = createEmptyPreferenceProfile('owner');
    const raw = mapPreferenceProfileToFormValue(current);
    raw['bp_curvy'] = true;
    raw['sp_tantra'] = true;
    raw['bodyPreferenceMode'] = 'require';
    raw['sexualPracticeMode'] = 'require';

    const result = mapFormValueToPreferenceProfile(
      raw,
      current,
      capabilities({
        currentPlan: 'basic',
        currentPlanLabel: 'Básico',
        hasActiveSubscription: true,
        canEditAdvancedPreferences: true,
        canUseContextualIntent: true,
      })
    );

    expect(result.softRules.bodyPreferences).toEqual(['curvy']);
    expect(result.softRules.sexualPractices).toEqual(['tantra']);
    expect(result.matchingModes.bodyPreferences).toBe('prefer');
    expect(result.matchingModes.sexualPractices).toBe('prefer');
  });

  it('Premium mantém preferências avançadas obrigatórias', () => {
    const current = createEmptyPreferenceProfile('owner');
    const raw = mapPreferenceProfileToFormValue(current);
    raw['bp_curvy'] = true;
    raw['bodyPreferenceMode'] = 'require';

    const result = mapFormValueToPreferenceProfile(
      raw,
      current,
      capabilities({
        currentPlan: 'premium',
        currentPlanLabel: 'Premium',
        hasActiveSubscription: true,
        canEditAdvancedPreferences: true,
        canRequireAdvancedPreferences: true,
        canUseAdvancedDiscovery: true,
        canUseDiscreetMode: true,
      })
    );

    expect(result.matchingModes.bodyPreferences).toBe('require');
  });

  it('normaliza modo VIP para padrão quando o entitlement não permite prioridade', () => {
    const current = createEmptyPreferenceProfile('owner');
    const raw = mapPreferenceProfileToFormValue(current);
    raw['discoveryMode'] = 'priority';

    const result = mapFormValueToPreferenceProfile(
      raw,
      current,
      capabilities({
        currentPlan: 'premium',
        currentPlanLabel: 'Premium',
        hasActiveSubscription: true,
        canEditAdvancedPreferences: true,
        canRequireAdvancedPreferences: true,
        canUseContextualIntent: true,
        canUseAdvancedDiscovery: true,
        canUseDiscreetMode: true,
        canSeeCompatibilityInsights: true,
      })
    );

    expect(result.visibility.discoveryMode).toBe('standard');
  });

  it('rejeita faixa etária invertida', () => {
    const validator = ageRangeValidator();
    const control = {
      get: (name: string) => ({ value: name === 'minAge' ? 50 : 25 }),
    } as never;

    expect(validator(control)).toEqual({ ageRangeOrder: true });
  });
});
