// src/app/preferences/utils/preference-profile-form.factory.spec.ts
import { describe, expect, it } from 'vitest';

import { PreferencesCapabilitySnapshot } from '../services/preferences-capability.service';
import { createEmptyPreferenceProfile } from './preference-normalizers';
import {
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

  it('permite alterar preferências avançadas com Básico ativo', () => {
    const current = createEmptyPreferenceProfile('owner');
    const raw = mapPreferenceProfileToFormValue(current);
    raw['bp_curvy'] = true;
    raw['sp_tantra'] = true;

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
        canUseContextualIntent: true,
        canUseAdvancedDiscovery: true,
        canUseDiscreetMode: true,
        canSeeCompatibilityInsights: true,
      })
    );

    expect(result.visibility.discoveryMode).toBe('standard');
  });
});
