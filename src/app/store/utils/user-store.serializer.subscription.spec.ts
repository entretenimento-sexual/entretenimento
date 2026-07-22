import { describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '../../core/interfaces/iuser-dados';
import { sanitizeUserForStore } from './user-store.serializer';

const NOW = 1_800_000_000_000;

function createUser(overrides: Partial<IUserDados> = {}): IUserDados {
  return {
    uid: 'u1',
    email: 'u1@example.com',
    photoURL: null,
    role: 'premium',
    tier: 'premium',
    lastLogin: NOW,
    descricao: '',
    profileCompleted: true,
    isSubscriber: true,
    monthlyPayer: true,
    subscriptionStatus: 'active',
    subscriptionScope: 'platform_subscription',
    ...overrides,
  };
}

describe('sanitizeUserForStore / subscription projection', () => {
  it('mantém plano somente com projeção canônica vigente', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    const user = sanitizeUserForStore(
      createUser({
        billingProjectionVersion: 1,
        subscriptionStartedAt: NOW - 60_000,
        subscriptionEndsAt: NOW + 60_000,
      })
    );

    expect(user.role).toBe('premium');
    expect(user.tier).toBe('premium');
    expect(user.isSubscriber).toBe(true);
    expect(user.subscriptionStatus).toBe('active');
    vi.restoreAllMocks();
  });

  it('rebaixa flags legadas sem versão e período', () => {
    const user = sanitizeUserForStore(createUser());

    expect(user.role).toBe('free');
    expect(user.tier).toBe('free');
    expect(user.isSubscriber).toBe(false);
    expect(user.monthlyPayer).toBe(false);
    expect(user.subscriptionStatus).toBe('inactive');
    expect(user.subscriptionScope).toBeNull();
  });
});
