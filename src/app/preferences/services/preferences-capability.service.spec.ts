// src/app/preferences/services/preferences-capability.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
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
    subscriptionEndsAt: now + 60 * 60 * 1000,
    ...overrides,
  } as IUserDados;
}

describe('PreferencesCapabilityService', () => {
  let service: PreferencesCapabilityService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PreferencesCapabilityService);
  });

  it('mantém preferências essenciais para conta autenticada gratuita', () => {
    const capabilities = service.getCapabilities({
      uid: 'free-user',
      role: 'free',
      tier: 'free',
      isSubscriber: false,
    } as IUserDados);

    expect(capabilities.currentPlan).toBe('free');
    expect(capabilities.canEditCorePreferences).toBe(true);
    expect(capabilities.canEditIntentState).toBe(true);
    expect(capabilities.canEditAdvancedPreferences).toBe(false);
    expect(capabilities.canUseContextualIntent).toBe(false);
  });

  it('não concede premium por role ou isSubscriber legados sem projeção válida', () => {
    const capabilities = service.getCapabilities({
      uid: 'legacy-user',
      role: 'premium',
      tier: 'premium',
      isSubscriber: true,
      subscriptionStatus: 'active',
    } as IUserDados);

    expect(capabilities.currentPlan).toBe('free');
    expect(capabilities.hasActiveSubscription).toBe(false);
    expect(capabilities.canUseDiscreetMode).toBe(false);
    expect(capabilities.canUsePriorityVisibility).toBe(false);
  });

  it('libera detalhes avançados e contexto no plano Básico', () => {
    const capabilities = service.getCapabilities(userWithPlan('basic'));

    expect(capabilities.currentPlan).toBe('basic');
    expect(capabilities.canEditAdvancedPreferences).toBe(true);
    expect(capabilities.canUseContextualIntent).toBe(true);
    expect(capabilities.canUseDiscreetMode).toBe(false);
    expect(capabilities.canSeeCompatibilityInsights).toBe(false);
  });

  it('libera descoberta discreta e compatibilidade no Premium', () => {
    const capabilities = service.getCapabilities(userWithPlan('premium'));

    expect(capabilities.currentPlan).toBe('premium');
    expect(capabilities.canUseAdvancedDiscovery).toBe(true);
    expect(capabilities.canUseDiscreetMode).toBe(true);
    expect(capabilities.canSeeCompatibilityInsights).toBe(true);
    expect(capabilities.canUsePriorityVisibility).toBe(false);
  });

  it('libera prioridade e boost somente no VIP', () => {
    const capabilities = service.getCapabilities(userWithPlan('vip'));

    expect(capabilities.currentPlan).toBe('vip');
    expect(capabilities.canUsePriorityVisibility).toBe(true);
    expect(capabilities.canUseIntentBoost).toBe(true);
  });

  it('trata assinatura expirada como plano gratuito', () => {
    const capabilities = service.getCapabilities(
      userWithPlan('vip', {
        subscriptionEndsAt: Date.now() - 1_000,
      })
    );

    expect(capabilities.currentPlan).toBe('free');
    expect(capabilities.hasActiveSubscription).toBe(false);
    expect(capabilities.canUsePriorityVisibility).toBe(false);
  });
});
