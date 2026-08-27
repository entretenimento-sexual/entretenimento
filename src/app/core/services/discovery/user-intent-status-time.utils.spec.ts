import { describe, expect, it, vi } from 'vitest';

import type { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import {
  formatUserIntentStatusExpiresIn,
  getNextUserIntentStatusTransitionAt,
  projectActiveUserIntentStatusCards,
  watchUserIntentStatusTime$,
} from './user-intent-status-time.utils';

describe('user intent status time utils', () => {
  it('atualiza o rótulo de expiração sem depender de nova emissão do Firestore', () => {
    const now = 1_800_000_000_000;
    const item = status('a', now + 2.5 * 60 * 60 * 1000);

    expect(formatUserIntentStatusExpiresIn(item.expiresAt, now)).toBe('Expira em 3h');
    expect(
      getNextUserIntentStatusTransitionAt([item], now)
    ).toBe(item.expiresAt - 2 * 60 * 60 * 1000);

    const afterBoundary = now + 31 * 60 * 1000;
    expect(
      projectActiveUserIntentStatusCards([item], afterBoundary)[0]?.expiresInLabel
    ).toBe('Expira em 2h');
  });

  it('remove o Momento exatamente após expirar mesmo sem nova emissão da fonte', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T20:00:00.000Z'));

    try {
      const now = Date.now();
      const item = status('expiring', now + 1_000);
      const emissions: readonly IUserIntentStatusCardVm[][] = [];
      const mutableEmissions = emissions as IUserIntentStatusCardVm[][];

      const subscription = watchUserIntentStatusTime$([item]).subscribe((items) => {
        mutableEmissions.push([...items]);
      });

      expect(mutableEmissions.at(-1)?.map((current) => current.id)).toEqual([
        'expiring',
      ]);

      await vi.advanceTimersByTimeAsync(1_001);

      expect(mutableEmissions.at(-1)).toEqual([]);
      subscription.unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('agenda apenas a próxima transição relevante entre vários Momentos', () => {
    const now = 1_800_000_000_000;
    const first = status('first', now + 20 * 60 * 1000);
    const second = status('second', now + 2.5 * 60 * 60 * 1000);

    expect(getNextUserIntentStatusTransitionAt([second, first], now)).toBe(
      first.expiresAt
    );
  });
});

function status(id: string, expiresAt: number): IUserIntentStatusCardVm {
  const startsAt = expiresAt - 12 * 60 * 60 * 1000;

  return {
    id,
    uid: `owner-${id}`,
    profile: {
      uid: `owner-${id}`,
      nickname: `Perfil ${id}`,
      photoURL: null,
      age: 30,
    },
    availability: 'available_today',
    visibility: 'public_discovery',
    destination: {
      kind: 'region',
      label: 'Niterói',
      region: { uf: 'RJ', city: 'niterói' },
    },
    moderation: { state: 'active' },
    startsAt,
    expiresAt,
    createdAt: startsAt,
    updatedAt: startsAt,
    destinationLabel: 'Niterói · niterói, RJ',
    availabilityLabel: 'Disponível hoje',
    expiresInLabel: 'Expira em 12h',
    isActive: true,
  };
}
