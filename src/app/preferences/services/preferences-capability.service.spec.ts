// src/app/preferences/services/preferences-capability.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { PreferencesCapabilityService } from './preferences-capability.service';

function userWithPlan(
  role: 'basic' | 'premium' | 'vip',
  overrides: Partial<IUserDados> = {}
): IUserDados {
  const now = Date.now();
  return {
    uid: `user-${role}`,
    role,
    tier: role,
    billingProjectionVersion: 1,
    isSubscriber: true,
    subscriptionStatus: 'active',
    subscriptionScope: 'platform_subscription',
    subscriptionStartedAt: now - 60_000,
    subscriptionEndsAt: now + 3_600_000,
    ...overrides,
  } as IUserDados;
}

describe('PreferencesCapabilityService', () => {
  let service: PreferencesCapabilityService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PreferencesCapabilityService);
  });

  it('mantém filtros essenciais na conta gratuita', () => {
    const capabilities = service.getCapabilities({
      uid: 'free-user', role: 'free', tier: 'free', isSubscriber: false,
    } as IUserDados);

    expect(capabilities.currentPlan).toBe('free');
    expect(capabilities.canEditCorePreferences).toBe(true);
    expect(capabilities.canEditAdvancedPreferences).toBe(false);
    expect(capabilities.canRequireAdvancedPreferences).toBe(false);
  });

  it('não concede plano por flags legadas sem projeção válida', () => {
    const capabilities = service.getCapabilities({
      uid: 'legacy-user', role: 'premium', tier: 'premium',
      isSubscriber: true, subscriptionStatus: 'active',
    } as IUserDados);

    expect(capabilities.currentPlan).toBe('free');
    expect(capabilities.hasActiveSubscription).toBe(false);
    expect(capabilities.canRequireAdvancedPreferences).toBe(false);
  });

  it('Básico libera seleção avançada, mas não filtro rígido', () => {
    const capabilities = service.getCapabilities(userWithPlan('basic'));
    expect(capabilities.canEditAdvancedPreferences).toBe(true);
    expect(capabilities.canRequireAdvancedPreferences).toBe(false);
    expect(capabilities.canUseContextualIntent).toBe(true);
  });

  it('Premium libera filtro avançado obrigatório', () => {
    const capabilities = service.getCapabilities(userWithPlan('premium'));
    expect(capabilities.canUseAdvancedDiscovery).toBe(true);
    expect(capabilities.canRequireAdvancedPreferences).toBe(true);
    expect(capabilities.canUseDiscreetMode).toBe(true);
    expect(capabilities.canUsePriorityVisibility).toBe(false);
  });

  it('VIP mantém filtros avançados e libera prioridade', () => {
    const capabilities = service.getCapabilities(userWithPlan('vip'));
    expect(capabilities.canRequireAdvancedPreferences).toBe(true);
    expect(capabilities.canUsePriorityVisibility).toBe(true);
    expect(capabilities.canUseIntentBoost).toBe(true);
  });

  it('trata assinatura expirada como gratuita', () => {
    const capabilities = service.getCapabilities(userWithPlan('vip', {
      subscriptionEndsAt: Date.now() - 1_000,
    }));
    expect(capabilities.currentPlan).toBe('free');
    expect(capabilities.canRequireAdvancedPreferences).toBe(false);
  });
});
