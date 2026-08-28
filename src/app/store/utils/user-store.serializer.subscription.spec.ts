import { describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '../../core/interfaces/iuser-dados';
import {
  sanitizeUserForStore,
  sanitizeValueForStore,
} from './user-store.serializer';

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

function firestoreTimestampLike(epochMs: number): {
  seconds: number;
  nanoseconds: number;
  toMillis: () => number;
} {
  return {
    seconds: Math.floor(epochMs / 1000),
    nanoseconds: (epochMs % 1000) * 1_000_000,
    toMillis: () => epochMs,
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

  it('converte Timestamp de métricas e objetos aninhados antes do NgRx', () => {
    const timestamp = firestoreTimestampLike(NOW);
    const rawUser = createUser() as IUserDados & {
      mediaMetricsUpdatedAt: unknown;
      mediaProjection: {
        updatedAt: unknown;
        history: unknown[];
      };
    };

    rawUser.mediaMetricsUpdatedAt = timestamp;
    rawUser.mediaProjection = {
      updatedAt: timestamp,
      history: [timestamp, new Date(NOW + 1_000)],
    };

    const user = sanitizeUserForStore(rawUser) as IUserDados & {
      mediaMetricsUpdatedAt: number;
      mediaProjection: {
        updatedAt: number;
        history: number[];
      };
    };

    expect(user.mediaMetricsUpdatedAt).toBe(NOW);
    expect(user.mediaProjection.updatedAt).toBe(NOW);
    expect(user.mediaProjection.history).toEqual([NOW, NOW + 1_000]);
    expect(JSON.stringify(user)).toContain(`"mediaMetricsUpdatedAt":${NOW}`);
    expect(rawUser.mediaMetricsUpdatedAt).toBe(timestamp);
  });

  it('remove protótipos e valores não serializáveis sem mutar a origem', () => {
    class ProjectionValue {
      constructor(
        readonly value: string,
        readonly updatedAt: unknown
      ) {}

      describe(): string {
        return this.value;
      }
    }

    const source = {
      projection: new ProjectionValue(
        'video',
        firestoreTimestampLike(NOW)
      ),
      ignored: undefined,
    };

    const sanitized = sanitizeValueForStore(source);

    expect(sanitized).toEqual({
      projection: {
        value: 'video',
        updatedAt: NOW,
      },
    });
    expect(Object.getPrototypeOf(sanitized.projection)).toBe(Object.prototype);
    expect(source.projection.describe()).toBe('video');
  });
});
