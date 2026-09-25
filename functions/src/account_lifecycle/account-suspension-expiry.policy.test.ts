import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateModerationSuspensionExpiry,
} from './account-suspension-expiry.policy';

const NOW = Date.UTC(2026, 8, 24, 23, 0, 0);

test('encerra suspensão moderada quando o prazo venceu', () => {
  const decision = evaluateModerationSuspensionExpiry({
    accountStatus: 'moderation_suspended',
    suspensionEndsAt: NOW - 1,
    now: NOW,
  });

  assert.equal(decision.due, true);
  assert.equal(decision.reason, 'due');
});

test('mantém suspensão moderada permanente sem prazo', () => {
  const decision = evaluateModerationSuspensionExpiry({
    accountStatus: 'moderation_suspended',
    suspensionEndsAt: null,
    now: NOW,
  });

  assert.equal(decision.due, false);
  assert.equal(decision.reason, 'no_expiry');
});

test('não encerra autossuspensão por este relógio', () => {
  const decision = evaluateModerationSuspensionExpiry({
    accountStatus: 'self_suspended',
    suspensionEndsAt: NOW - 1,
    now: NOW,
  });

  assert.equal(decision.due, false);
  assert.equal(decision.reason, 'not_moderation_suspended');
});

test('não encerra suspensão antes da data final', () => {
  const decision = evaluateModerationSuspensionExpiry({
    accountStatus: 'moderation_suspended',
    suspensionEndsAt: NOW + 60_000,
    now: NOW,
  });

  assert.equal(decision.due, false);
  assert.equal(decision.reason, 'not_due');
});
