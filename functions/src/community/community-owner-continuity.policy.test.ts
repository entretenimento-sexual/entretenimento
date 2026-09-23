import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityOwnerContinuity,
} from './community-owner-continuity.policy';

test('downgrade não transfere propriedade e entra em regularização', () => {
  const decision = evaluateCommunityOwnerContinuity({
    ownerAccountState: 'active',
    planSupportsCurrentOwnership: false,
  });

  assert.equal(decision.ownershipMode, 'regularization');
  assert.equal(decision.retainCanonicalOwnerPointer, true);
  assert.equal(decision.automaticInheritanceAllowed, false);
  assert.equal(
    decision.reason,
    'owner_plan_regularization_required'
  );
});

test('suspensão temporária não escolhe herdeiro', () => {
  for (const ownerAccountState of [
    'self_suspended',
    'moderation_suspended',
  ] as const) {
    const decision = evaluateCommunityOwnerContinuity({
      ownerAccountState,
      planSupportsCurrentOwnership: true,
    });

    assert.equal(decision.ownershipMode, 'temporarily_restricted');
    assert.equal(decision.retainCanonicalOwnerPointer, true);
    assert.equal(decision.automaticInheritanceAllowed, false);
  }
});

test('exclusão pendente exige resolução sem herança automática', () => {
  const decision = evaluateCommunityOwnerContinuity({
    ownerAccountState: 'pending_deletion',
    planSupportsCurrentOwnership: true,
  });

  assert.equal(decision.ownershipMode, 'resolution_required');
  assert.equal(decision.retainCanonicalOwnerPointer, true);
  assert.equal(decision.explicitSuccessorAcceptanceRequired, true);
  assert.equal(decision.automaticInheritanceAllowed, false);
});

test('conta removida abre sucessão guardada com aceite explícito', () => {
  const decision = evaluateCommunityOwnerContinuity({
    ownerAccountState: 'deleted',
    planSupportsCurrentOwnership: true,
  });

  assert.equal(decision.ownershipMode, 'guarded_succession');
  assert.equal(decision.retainCanonicalOwnerPointer, false);
  assert.equal(decision.explicitSuccessorAcceptanceRequired, true);
  assert.equal(decision.automaticInheritanceAllowed, false);
});

test('mera inatividade não é tratada como abandono', () => {
  const decision = evaluateCommunityOwnerContinuity({
    ownerAccountState: 'active',
    planSupportsCurrentOwnership: true,
    abandonmentConfirmed: false,
  });

  assert.equal(decision.ownershipMode, 'normal');
  assert.equal(decision.retainCanonicalOwnerPointer, true);
});

test('abandono confirmado exige sucessão guardada e nunca automática', () => {
  const decision = evaluateCommunityOwnerContinuity({
    ownerAccountState: 'active',
    planSupportsCurrentOwnership: true,
    abandonmentConfirmed: true,
  });

  assert.equal(decision.ownershipMode, 'guarded_succession');
  assert.equal(decision.retainCanonicalOwnerPointer, false);
  assert.equal(decision.explicitSuccessorAcceptanceRequired, true);
  assert.equal(decision.automaticInheritanceAllowed, false);
});
