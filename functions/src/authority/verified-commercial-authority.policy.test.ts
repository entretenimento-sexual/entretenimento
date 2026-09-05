import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateVerifiedCommercialAuthority,
} from './verified-commercial-authority.policy';

const NOW = 1_800_000_000_000;

function activeGrant(overrides: Record<string, unknown> = {}) {
  return {
    holderUid: 'user-1',
    organizationId: 'organization-1',
    verificationStatus: 'verified',
    active: true,
    startsAt: NOW - 1_000,
    endsAt: NOW + 10_000,
    ...overrides,
  };
}

test('valida autoridade comercial verificada e vigente', () => {
  assert.deepEqual(
    evaluateVerifiedCommercialAuthority({
      actorUid: 'user-1',
      rawGrant: activeGrant(),
      now: NOW,
    }),
    {
      allowed: true,
      holderUid: 'user-1',
      organizationId: 'organization-1',
      denialReason: null,
    }
  );
});

test('falha fechado para holder divergente ou verificação ausente', () => {
  assert.equal(
    evaluateVerifiedCommercialAuthority({
      actorUid: 'user-2',
      rawGrant: activeGrant(),
      now: NOW,
    }).denialReason,
    'authority_mismatch'
  );

  assert.equal(
    evaluateVerifiedCommercialAuthority({
      actorUid: 'user-1',
      rawGrant: activeGrant({ verificationStatus: 'pending' }),
      now: NOW,
    }).denialReason,
    'verification_required'
  );
});

test('falha fechado para concessão inativa, expirada ou janela malformada', () => {
  for (const rawGrant of [
    activeGrant({ active: false }),
    activeGrant({ endsAt: NOW }),
    activeGrant({ endsAt: 'sem-data-valida' }),
    activeGrant({ startsAt: 'sem-data-valida' }),
  ]) {
    assert.equal(
      evaluateVerifiedCommercialAuthority({
        actorUid: 'user-1',
        rawGrant,
        now: NOW,
      }).denialReason,
      'authority_inactive'
    );
  }
});

test('não transforma grant inexistente em autoridade implícita', () => {
  assert.equal(
    evaluateVerifiedCommercialAuthority({
      actorUid: 'user-1',
      rawGrant: null,
      now: NOW,
    }).denialReason,
    'authority_missing'
  );
});
