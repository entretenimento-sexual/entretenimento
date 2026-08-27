// functions/src/community/community-membership-request.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityMembershipLeave,
  evaluateCommunityMembershipRequest,
  evaluateCommunityMembershipReview,
} from './community-membership-request.policy';

const BASE_INPUT = Object.freeze({
  operational: true,
  publicPreview: true,
  join: 'approval' as const,
  existingStatus: null,
  actorEligible: true,
});

const LEAVE_COMMUNITY_STATUS = 'active' as const;

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

test('saída ativa reduz contagem e cancelamento pendente não reduz', () => {
  const active = evaluateCommunityMembershipLeave({
    communityStatus: LEAVE_COMMUNITY_STATUS,
    existingStatus: 'active',
    existingRole: 'member',
  });
  const pending = evaluateCommunityMembershipLeave({
    communityStatus: LEAVE_COMMUNITY_STATUS,
    existingStatus: 'pending',
    existingRole: 'member',
  });

  assert.equal(active.allowed, true);
  assert.equal(active.targetStatus, 'left');
  assert.equal(active.decrementMemberCount, true);
  assert.equal(active.releaseOwnership, false);
  assert.equal(active.auditAction, 'community-membership-left');
  assert.equal(pending.allowed, true);
  assert.equal(pending.decrementMemberCount, false);
  assert.equal(pending.releaseOwnership, false);
  assert.equal(
    pending.auditAction,
    'community-membership-request-cancelled'
  );
});

test('saída já concluída é idempotente e owner operacional exige transferência', () => {
  const left = evaluateCommunityMembershipLeave({
    communityStatus: LEAVE_COMMUNITY_STATUS,
    existingStatus: 'left',
    existingRole: 'member',
  });
  const owner = evaluateCommunityMembershipLeave({
    communityStatus: LEAVE_COMMUNITY_STATUS,
    existingStatus: 'active',
    existingRole: 'owner',
  });

  assert.equal(left.allowed, true);
  assert.equal(left.idempotent, true);
  assert.equal(owner.allowed, false);
  assert.equal(owner.releaseOwnership, false);
  assert.equal(owner.denialReason, 'owner_transfer_required');
});

test('owner pode encerrar vínculo em estado terminal e libera propriedade', () => {
  for (const communityStatus of [
    'archived',
    'scheduled_for_deletion',
  ] as const) {
    const decision = evaluateCommunityMembershipLeave({
      communityStatus,
      existingStatus: 'active',
      existingRole: 'owner',
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.targetStatus, 'left');
    assert.equal(decision.decrementMemberCount, true);
    assert.equal(decision.releaseOwnership, true);
    assert.equal(decision.auditAction, 'community-membership-left');
  }
});

test('owner dormente continua protegido até reativação e transferência', () => {
  const decision = evaluateCommunityMembershipLeave({
    communityStatus: 'dormant',
    existingStatus: 'active',
    existingRole: 'owner',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.releaseOwnership, false);
  assert.equal(decision.denialReason, 'owner_transfer_required');
});

test('nega saída quando o vínculo não possui papel válido', () => {
  const decision = evaluateCommunityMembershipLeave({
    communityStatus: LEAVE_COMMUNITY_STATUS,
    existingStatus: 'active',
    existingRole: null,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'membership_not_found');
  assert.equal(decision.decrementMemberCount, false);
  assert.equal(decision.releaseOwnership, false);
});

test('moderador aprova pendência e incrementa membros', () => {
  const decision = evaluateCommunityMembershipReview({
    actorActive: true,
    actorRole: 'moderator',
    targetIsActor: false,
    targetStatus: 'pending',
    targetRole: 'member',
    action: 'approve',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.targetStatus, 'active');
  assert.equal(decision.incrementMemberCount, true);
  assert.equal(decision.auditAction, 'community-membership-approved');
});

test('moderador rejeita pendência sem alterar contagem', () => {
  const decision = evaluateCommunityMembershipReview({
    actorActive: true,
    actorRole: 'admin',
    targetIsActor: false,
    targetStatus: 'pending',
    targetRole: 'member',
    action: 'reject',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.targetStatus, 'left');
  assert.equal(decision.incrementMemberCount, false);
  assert.equal(decision.auditAction, 'community-membership-rejected');
});

test('revisão repetida preserva aprovação ou rejeição sem nova métrica', () => {
  const approved = evaluateCommunityMembershipReview({
    actorActive: true,
    actorRole: 'moderator',
    targetIsActor: false,
    targetStatus: 'active',
    targetRole: 'member',
    action: 'approve',
  });
  const rejected = evaluateCommunityMembershipReview({
    actorActive: true,
    actorRole: 'moderator',
    targetIsActor: false,
    targetStatus: 'left',
    targetRole: 'member',
    action: 'reject',
  });

  assert.equal(approved.idempotent, true);
  assert.equal(approved.incrementMemberCount, false);
  assert.equal(rejected.idempotent, true);
  assert.equal(rejected.incrementMemberCount, false);
});

test('revisão exige papel, alvo válido e impede autorrevisão', () => {
  assert.equal(
    evaluateCommunityMembershipReview({
      actorActive: true,
      actorRole: 'member',
      targetIsActor: false,
      targetStatus: 'pending',
      targetRole: 'member',
      action: 'approve',
    }).denialReason,
    'moderator_required'
  );
  assert.equal(
    evaluateCommunityMembershipReview({
      actorActive: true,
      actorRole: 'moderator',
      targetIsActor: true,
      targetStatus: 'pending',
      targetRole: 'member',
      action: 'approve',
    }).denialReason,
    'self_review_forbidden'
  );
  assert.equal(
    evaluateCommunityMembershipReview({
      actorActive: true,
      actorRole: 'owner',
      targetIsActor: false,
      targetStatus: 'active',
      targetRole: 'moderator',
      action: 'reject',
    }).denialReason,
    'protected_membership'
  );
  assert.equal(
    evaluateCommunityMembershipReview({
      actorActive: true,
      actorRole: 'owner',
      targetIsActor: false,
      targetStatus: 'pending',
      targetRole: null,
      action: 'approve',
    }).denialReason,
    'protected_membership'
  );
});
