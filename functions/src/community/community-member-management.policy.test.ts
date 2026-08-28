// functions/src/community/community-member-management.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CommunityMemberManagementInput,
  evaluateCommunityMemberManagement,
} from './community-member-management.policy';

function input(
  overrides: Partial<CommunityMemberManagementInput> = {}
): CommunityMemberManagementInput {
  return {
    sourceType: 'community',
    actorUid: 'owner-1',
    targetUid: 'member-1',
    actorStatus: 'active',
    actorRole: 'owner',
    targetStatus: 'active',
    targetRole: 'member',
    action: 'set_role',
    nextRole: 'moderator',
    ...overrides,
  };
}

test('proprietário pode atribuir Administração, Moderação e Membro', () => {
  for (const nextRole of ['admin', 'moderator', 'member'] as const) {
    const decision = evaluateCommunityMemberManagement(input({ nextRole }));
    assert.equal(decision.allowed, true);
    assert.equal(decision.targetNextRole, nextRole);
  }
});

test('Admin pode alternar apenas Membro e Moderação', () => {
  assert.equal(
    evaluateCommunityMemberManagement(input({
      actorRole: 'admin',
      targetRole: 'member',
      nextRole: 'moderator',
    })).allowed,
    true
  );

  assert.equal(
    evaluateCommunityMemberManagement(input({
      actorRole: 'admin',
      targetRole: 'moderator',
      nextRole: 'member',
    })).allowed,
    true
  );

  assert.equal(
    evaluateCommunityMemberManagement(input({
      actorRole: 'admin',
      targetRole: 'member',
      nextRole: 'admin',
    })).denialReason,
    'role_change_forbidden'
  );

  assert.equal(
    evaluateCommunityMemberManagement(input({
      actorRole: 'admin',
      targetRole: 'admin',
      nextRole: 'member',
    })).denialReason,
    'role_change_forbidden'
  );
});

test('Moderador não altera papéis, mas pode remover ou bloquear Membro', () => {
  assert.equal(
    evaluateCommunityMemberManagement(input({
      actorRole: 'moderator',
      action: 'set_role',
      nextRole: 'moderator',
    })).denialReason,
    'role_change_forbidden'
  );

  const removeDecision = evaluateCommunityMemberManagement(input({
    actorRole: 'moderator',
    action: 'remove',
    nextRole: null,
  }));
  assert.equal(removeDecision.allowed, true);
  assert.equal(removeDecision.targetNextStatus, 'left');
  assert.equal(removeDecision.decrementMemberCount, true);

  const blockDecision = evaluateCommunityMemberManagement(input({
    actorRole: 'moderator',
    action: 'block',
    nextRole: null,
  }));
  assert.equal(blockDecision.allowed, true);
  assert.equal(blockDecision.targetNextStatus, 'blocked');
  assert.equal(blockDecision.targetNextRole, 'member');
  assert.equal(blockDecision.decrementMemberCount, true);
});

test('Admin não remove nem bloqueia outro Admin', () => {
  for (const action of ['remove', 'block'] as const) {
    const decision = evaluateCommunityMemberManagement(input({
      actorRole: 'admin',
      targetRole: 'admin',
      action,
      nextRole: null,
    }));
    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'action_forbidden');
  }
});

test('proprietário é protegido e autoação é proibida', () => {
  assert.equal(
    evaluateCommunityMemberManagement(input({ targetRole: 'owner' })).denialReason,
    'owner_protected'
  );

  assert.equal(
    evaluateCommunityMemberManagement(input({ targetUid: 'owner-1' })).denialReason,
    'self_action_forbidden'
  );
});

test('bloqueio remove privilégios e desbloqueio retorna para left', () => {
  const blockDecision = evaluateCommunityMemberManagement(input({
    targetRole: 'admin',
    action: 'block',
    nextRole: null,
  }));

  assert.equal(blockDecision.allowed, true);
  assert.equal(blockDecision.targetNextStatus, 'blocked');
  assert.equal(blockDecision.targetNextRole, 'member');

  const unblockDecision = evaluateCommunityMemberManagement(input({
    targetStatus: 'blocked',
    targetRole: 'member',
    targetRoleBeforeBlock: 'admin',
    targetBlockedByRole: 'owner',
    action: 'unblock',
    nextRole: null,
  }));

  assert.equal(unblockDecision.allowed, true);
  assert.equal(unblockDecision.targetNextStatus, 'left');
  assert.equal(unblockDecision.targetNextRole, 'member');
  assert.equal(unblockDecision.decrementMemberCount, false);
});

test('Moderador só desfaz bloqueio próprio de Membro', () => {
  const ownBlock = evaluateCommunityMemberManagement(input({
    actorRole: 'moderator',
    targetStatus: 'blocked',
    targetRole: 'member',
    targetRoleBeforeBlock: 'member',
    targetBlockedByActor: true,
    targetBlockedByRole: 'moderator',
    action: 'unblock',
    nextRole: null,
  }));
  assert.equal(ownBlock.allowed, true);

  const foreignBlock = evaluateCommunityMemberManagement(input({
    actorRole: 'moderator',
    targetStatus: 'blocked',
    targetRole: 'member',
    targetRoleBeforeBlock: 'member',
    targetBlockedByActor: false,
    targetBlockedByRole: 'moderator',
    action: 'unblock',
    nextRole: null,
  }));
  assert.equal(foreignBlock.allowed, false);
  assert.equal(foreignBlock.denialReason, 'action_forbidden');

  const formerAdmin = evaluateCommunityMemberManagement(input({
    actorRole: 'moderator',
    targetStatus: 'blocked',
    targetRole: 'member',
    targetRoleBeforeBlock: 'admin',
    targetBlockedByActor: true,
    targetBlockedByRole: 'moderator',
    action: 'unblock',
    nextRole: null,
  }));
  assert.equal(formerAdmin.allowed, false);
  assert.equal(formerAdmin.denialReason, 'action_forbidden');
});

test('Admin respeita papel anterior e hierarquia de quem bloqueou', () => {
  assert.equal(
    evaluateCommunityMemberManagement(input({
      actorRole: 'admin',
      targetStatus: 'blocked',
      targetRole: 'member',
      targetRoleBeforeBlock: 'admin',
      targetBlockedByRole: 'owner',
      action: 'unblock',
      nextRole: null,
    })).denialReason,
    'action_forbidden'
  );

  assert.equal(
    evaluateCommunityMemberManagement(input({
      actorRole: 'admin',
      targetStatus: 'blocked',
      targetRole: 'member',
      targetRoleBeforeBlock: 'member',
      targetBlockedByRole: 'owner',
      action: 'unblock',
      nextRole: null,
    })).denialReason,
    'action_forbidden'
  );

  for (const previousRole of ['member', 'moderator'] as const) {
    for (const blockerRole of ['admin', 'moderator'] as const) {
      assert.equal(
        evaluateCommunityMemberManagement(input({
          actorRole: 'admin',
          targetStatus: 'blocked',
          targetRole: 'member',
          targetRoleBeforeBlock: previousRole,
          targetBlockedByRole: blockerRole,
          action: 'unblock',
          nextRole: null,
        })).allowed,
        true
      );
    }
  }
});

test('bloqueio legado sem metadados hierárquicos só pode ser desfeito pelo Proprietário', () => {
  assert.equal(
    evaluateCommunityMemberManagement(input({
      targetStatus: 'blocked',
      targetRole: 'member',
      targetRoleBeforeBlock: null,
      targetBlockedByRole: null,
      action: 'unblock',
      nextRole: null,
    })).allowed,
    true
  );

  assert.equal(
    evaluateCommunityMemberManagement(input({
      actorRole: 'admin',
      targetStatus: 'blocked',
      targetRole: 'member',
      targetRoleBeforeBlock: 'member',
      targetBlockedByRole: null,
      action: 'unblock',
      nextRole: null,
    })).allowed,
    false
  );
});

test('Local e ator sem papel de gestão são negados', () => {
  assert.equal(
    evaluateCommunityMemberManagement(input({ sourceType: 'venue' })).denialReason,
    'community_source_not_supported'
  );

  assert.equal(
    evaluateCommunityMemberManagement(input({ actorRole: 'member' })).denialReason,
    'manager_required'
  );
});
