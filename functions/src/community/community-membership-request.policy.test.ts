// functions/src/community/community-membership-request.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCommunityMembershipRequest } from './community-membership-request.policy';

const BASE_INPUT = Object.freeze({
  operational: true,
  publicPreview: true,
  join: 'approval' as const,
  existingStatus: null,
  actorEligible: true,
  entitlementAllowed: true,
});

test('cria membership ativa para entrada aberta', () => {
  const decision = evaluateCommunityMembershipRequest({
    ...BASE_INPUT,
    join: 'open',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.targetStatus, 'active');
  assert.equal(decision.incrementMemberCount, true);
});

test('cria solicitação pendente quando a comunidade exige aprovação', () => {
  const decision = evaluateCommunityMembershipRequest(BASE_INPUT);

  assert.equal(decision.allowed, true);
  assert.equal(decision.targetStatus, 'pending');
  assert.equal(decision.incrementMemberCount, false);
});

test('mantém membership ativa ou pendente de forma idempotente', () => {
  const active = evaluateCommunityMembershipRequest({
    ...BASE_INPUT,
    existingStatus: 'active',
  });
  const pending = evaluateCommunityMembershipRequest({
    ...BASE_INPUT,
    existingStatus: 'pending',
  });

  assert.equal(active.idempotent, true);
  assert.equal(active.targetStatus, 'active');
  assert.equal(active.incrementMemberCount, false);
  assert.equal(pending.idempotent, true);
  assert.equal(pending.targetStatus, 'pending');
});

test('membership existente continua exigindo entitlement vigente', () => {
  const active = evaluateCommunityMembershipRequest({
    ...BASE_INPUT,
    existingStatus: 'active',
    entitlementAllowed: false,
  });
  const pending = evaluateCommunityMembershipRequest({
    ...BASE_INPUT,
    existingStatus: 'pending',
    entitlementAllowed: false,
  });

  assert.equal(active.denialReason, 'subscription_required');
  assert.equal(pending.denialReason, 'subscription_required');
});

test('permite nova entrada depois de saída voluntária', () => {
  const decision = evaluateCommunityMembershipRequest({
    ...BASE_INPUT,
    join: 'open',
    existingStatus: 'left',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.targetStatus, 'active');
  assert.equal(decision.incrementMemberCount, true);
});

test('nega usuário bloqueado mesmo em comunidade aberta', () => {
  const decision = evaluateCommunityMembershipRequest({
    ...BASE_INPUT,
    join: 'open',
    existingStatus: 'blocked',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'membership_blocked');
});

test('nega comunidade indisponível, convite e ator restrito', () => {
  assert.equal(
    evaluateCommunityMembershipRequest({
      ...BASE_INPUT,
      operational: false,
    }).denialReason,
    'community_unavailable'
  );
  assert.equal(
    evaluateCommunityMembershipRequest({
      ...BASE_INPUT,
      join: 'invite_only',
    }).denialReason,
    'invite_only'
  );
  assert.equal(
    evaluateCommunityMembershipRequest({
      ...BASE_INPUT,
      actorEligible: false,
    }).denialReason,
    'actor_restricted'
  );
});

test('nega quando o entitlement exigido não foi confirmado', () => {
  const decision = evaluateCommunityMembershipRequest({
    ...BASE_INPUT,
    entitlementAllowed: false,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'subscription_required');
});
