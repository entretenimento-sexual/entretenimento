import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVENT_AUTHORITY_POLICY_VERSION,
  buildEventAuthorityRecordId,
  evaluateEventAuthority,
} from './event-authority.policy';

const NOW = 1_800_000_000_000;

function authority(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'event-1',
    eventLabel: 'Evento Um',
    eventStatus: 'active',
    holderUid: 'user-1',
    role: 'organizer',
    status: 'active',
    sponsorOrganizationId: null,
    policyVersion: EVENT_AUTHORITY_POLICY_VERSION,
    startsAt: NOW - 10_000,
    endsAt: NOW + 30_000,
    revalidationDueAt: NOW + 20_000,
    revokedAt: null,
    ...overrides,
  };
}

test('id canônico vincula evento e titular sem depender do cliente', () => {
  assert.equal(
    buildEventAuthorityRecordId('event-1', 'user-1'),
    'event-1:user-1'
  );
  assert.equal(buildEventAuthorityRecordId('event inválido', 'user-1'), null);
});

for (const role of ['organizer', 'promoter', 'responsible'] as const) {
  test(`aceita autoridade canônica ativa de Evento para ${role}`, () => {
    assert.deepEqual(evaluateEventAuthority({
      actorUid: 'user-1',
      eventId: 'event-1',
      rawAuthorityRecord: authority({ role }),
      now: NOW,
    }), {
      allowed: true,
      eventId: 'event-1',
      holderUid: 'user-1',
      role,
      sponsorOrganizationId: null,
      verificationPolicyVersion: EVENT_AUTHORITY_POLICY_VERSION,
      denialReason: null,
    });
  });
}

test('falha fechado para creator/organizer informal sem registro canônico', () => {
  const result = evaluateEventAuthority({
    actorUid: 'user-1',
    eventId: 'event-1',
    rawAuthorityRecord: {
      eventId: 'event-1',
      creatorUid: 'user-1',
      organizerUid: 'user-1',
    },
    now: NOW,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.denialReason, 'authority_mismatch');
});

test('rejeita titular divergente, evento inativo e autorização vencida', () => {
  assert.equal(evaluateEventAuthority({
    actorUid: 'user-1',
    eventId: 'event-1',
    rawAuthorityRecord: authority({ holderUid: 'user-2' }),
    now: NOW,
  }).denialReason, 'authority_mismatch');

  assert.equal(evaluateEventAuthority({
    actorUid: 'user-1',
    eventId: 'event-1',
    rawAuthorityRecord: authority({ eventStatus: 'cancelled' }),
    now: NOW,
  }).denialReason, 'event_inactive');

  assert.equal(evaluateEventAuthority({
    actorUid: 'user-1',
    eventId: 'event-1',
    rawAuthorityRecord: authority({ endsAt: NOW }),
    now: NOW,
  }).denialReason, 'authority_inactive');
});


test('revogação do ledger invalida imediatamente a autoridade canônica', () => {
  const result = evaluateEventAuthority({
    actorUid: 'user-1',
    eventId: 'event-1',
    rawAuthorityRecord: authority({
      status: 'revoked',
      revokedAt: NOW - 1,
    }),
    now: NOW,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.denialReason, 'authority_inactive');
});
