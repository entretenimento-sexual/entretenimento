import { describe, expect, it } from 'vitest';

import type { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import {
  chunkUserIntentStatusOwnerUids,
  mergeUserIntentStatusCardPages,
  normalizeUserIntentStatusOwnerUids,
} from './user-intent-status-owner-query.utils';

describe('user intent status owner query utils', () => {
  it('normaliza e preserva mais de 30 autores sem corte silencioso', () => {
    const ownerUids = [
      '  owner-1  ',
      '',
      ...Array.from({ length: 65 }, (_, index) => `owner-${index + 1}`),
      'owner-12',
    ];

    const normalized = normalizeUserIntentStatusOwnerUids(ownerUids);

    expect(normalized).toHaveLength(65);
    expect(normalized[0]).toBe('owner-1');
    expect(normalized[64]).toBe('owner-65');
  });

  it('divide 65 autores em consultas Firestore de 30, 30 e 5', () => {
    const ownerUids = Array.from(
      { length: 65 },
      (_, index) => `owner-${index + 1}`
    );

    const chunks = chunkUserIntentStatusOwnerUids(ownerUids);

    expect(chunks.map((chunk) => chunk.length)).toEqual([30, 30, 5]);
    expect(chunks.flat()).toEqual(ownerUids);
  });

  it('funde páginas, remove duplicatas e aplica o limite global por expiração', () => {
    const pages = [
      [status('a', 'owner-a', 5), status('d', 'owner-d', 40)],
      [status('b', 'owner-b', 10), status('a', 'owner-a', 5)],
      [status('c', 'owner-c', 15), status('e', 'owner-e', 50)],
    ];

    const merged = mergeUserIntentStatusCardPages(pages, 4);

    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(merged.map((item) => item.id)).size).toBe(4);
  });
});

function status(
  id: string,
  uid: string,
  expiresInMinutes: number
): IUserIntentStatusCardVm {
  const now = 1_800_000_000_000;

  return {
    id,
    uid,
    profile: {
      uid,
      nickname: uid,
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
    startsAt: now,
    expiresAt: now + expiresInMinutes * 60_000,
    createdAt: now,
    updatedAt: now,
    destinationLabel: 'Niterói · niterói, RJ',
    availabilityLabel: 'Disponível hoje',
    expiresInLabel: `Expira em ${expiresInMinutes} min`,
    isActive: true,
  };
}
