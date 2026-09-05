import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_OFFICIAL_AUTOMATED_REVALIDATION_INTERVAL_MS,
  resolveCommunityOfficialVerificationWindow,
} from './community-official-verification-window.policy';

const NOW = 1_800_000_000_000;

test('agenda revalidação periódica quando a fonte não possui prazo próprio', () => {
  assert.deepEqual(
    resolveCommunityOfficialVerificationWindow({ now: NOW }),
    {
      revalidationDueAt:
        NOW + COMMUNITY_OFFICIAL_AUTOMATED_REVALIDATION_INTERVAL_MS,
      verificationExpiresAt: null,
    }
  );
});

test('prioriza revalidação e expiração mais próximas da fonte canônica', () => {
  assert.deepEqual(
    resolveCommunityOfficialVerificationWindow({
      now: NOW,
      sourceRevalidationDueAt: NOW + 10_000,
      sourceExpiryCandidates: [NOW + 30_000, NOW + 20_000],
    }),
    {
      revalidationDueAt: NOW + 10_000,
      verificationExpiresAt: NOW + 20_000,
    }
  );
});

test('não agenda revalidação depois de uma expiração mais próxima', () => {
  assert.deepEqual(
    resolveCommunityOfficialVerificationWindow({
      now: NOW,
      sourceExpiryCandidates: [NOW + 5_000],
    }),
    {
      revalidationDueAt: null,
      verificationExpiresAt: NOW + 5_000,
    }
  );
});

test('ignora prazos inválidos e escolhe a menor expiração futura', () => {
  assert.deepEqual(
    resolveCommunityOfficialVerificationWindow({
      now: NOW,
      sourceRevalidationDueAt: NOW - 1,
      sourceExpiryCandidates: [
        null,
        NOW - 1,
        NOW + 40_000,
        NOW + 15_000,
      ],
    }),
    {
      revalidationDueAt: null,
      verificationExpiresAt: NOW + 15_000,
    }
  );
});
