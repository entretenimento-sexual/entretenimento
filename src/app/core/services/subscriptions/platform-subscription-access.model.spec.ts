import { describe, expect, it } from 'vitest';

import type { IUserDados } from '../../interfaces/iuser-dados';
import {
  evaluatePlatformSubscriptionProjection,
  hasMinimumPlatformSubscriptionRole,
} from './platform-subscription-access.model';

const NOW = 1_800_000_000_000;

function createUser(overrides: Partial<IUserDados> = {}): IUserDados {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    photoURL: null,
    role: 'premium',
    tier: 'premium',
    lastLogin: NOW,
    descricao: '',
    billingProjectionVersion: 1,
    isSubscriber: true,
    monthlyPayer: true,
    subscriptionStatus: 'active',
    subscriptionScope: 'platform_subscription',
    subscriptionStartedAt: NOW - 60_000,
    subscriptionEndsAt: NOW + 60_000,
    ...overrides,
  };
}

describe('evaluatePlatformSubscriptionProjection', () => {
  it('aceita somente projeção versionada e vigente', () => {
    expect(evaluatePlatformSubscriptionProjection(createUser(), NOW)).toEqual({
      active: true,
      role: 'premium',
      startsAt: NOW - 60_000,
      endsAt: NOW + 60_000,
      projectionVersion: 1,
      reason: null,
    });
  });

  it('nega flags ativas com término expirado', () => {
    const state = evaluatePlatformSubscriptionProjection(
      createUser({ subscriptionEndsAt: NOW }),
      NOW
    );

    expect(state.active).toBe(false);
    expect(state.reason).toBe('expired');
  });

  it('nega projeção legada sem versão', () => {
    const state = evaluatePlatformSubscriptionProjection(
      createUser({ billingProjectionVersion: null }),
      NOW
    );

    expect(state.active).toBe(false);
    expect(state.reason).toBe('projection-version');
  });

  it('nega inconsistência entre flag, status, escopo e período', () => {
    expect(
      evaluatePlatformSubscriptionProjection(
        createUser({ isSubscriber: false }),
        NOW
      ).reason
    ).toBe('inactive-flag');

    expect(
      evaluatePlatformSubscriptionProjection(
        createUser({ subscriptionStatus: 'inactive' }),
        NOW
      ).reason
    ).toBe('inactive-status');

    expect(
      evaluatePlatformSubscriptionProjection(
        createUser({ subscriptionScope: null }),
        NOW
      ).reason
    ).toBe('invalid-scope');

    expect(
      evaluatePlatformSubscriptionProjection(
        createUser({ subscriptionStartedAt: NOW + 1 }),
        NOW
      ).reason
    ).toBe('not-started');
  });

  it('usa tier pago sem confundir role administrativo com plano', () => {
    const state = evaluatePlatformSubscriptionProjection(
      createUser({ role: 'admin', tier: 'vip' }),
      NOW
    );

    expect(state.active).toBe(true);
    expect(state.role).toBe('vip');
  });

  it('aplica hierarquia de planos', () => {
    expect(hasMinimumPlatformSubscriptionRole('vip', 'premium')).toBe(true);
    expect(hasMinimumPlatformSubscriptionRole('premium', 'premium')).toBe(true);
    expect(hasMinimumPlatformSubscriptionRole('basic', 'premium')).toBe(false);
    expect(hasMinimumPlatformSubscriptionRole(null, 'basic')).toBe(false);
  });
});
