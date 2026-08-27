// functions/src/community/community-invite.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canSendCommunityInvite,
  evaluateCommunityInviteResponse,
  evaluateCommunityInviteRevoke,
  evaluateCommunityInviteSend,
} from './community-invite.policy';
import {
  normalizeCommunityInviteCandidateRequest,
  normalizeCommunityInviteManagementRequest,
} from './community-invite-management.model';

test('expõe a capability de convite sem promover membro por padrão', () => {
  assert.equal(canSendCommunityInvite('active', 'owner', false), true);
  assert.equal(canSendCommunityInvite('active', 'moderator', false), true);
  assert.equal(canSendCommunityInvite('active', 'member', false), false);
  assert.equal(canSendCommunityInvite('active', 'member', true), true);
  assert.equal(canSendCommunityInvite('left', 'owner', true), false);
});

test('normaliza busca exata de apelido sem permitir enumeração livre', () => {
  assert.deepEqual(normalizeCommunityInviteCandidateRequest({
    communityId: ' community-1 ',
    nickname: ' João Oficial ',
  }), {
    communityId: 'community-1',
    nicknameNormalized: 'joao_oficial',
  });

  assert.equal(normalizeCommunityInviteCandidateRequest({
    communityId: 'community-1',
    nickname: 'ab',
  }), null);
  assert.equal(normalizeCommunityInviteCandidateRequest({
    communityId: '../unsafe',
    nickname: 'Pessoa Segura',
  }), null);
});

test('normaliza somente identificador comunitário seguro para listagem', () => {
  assert.equal(
    normalizeCommunityInviteManagementRequest({ communityId: 'community-1' }),
    'community-1'
  );
  assert.equal(
    normalizeCommunityInviteManagementRequest({ communityId: 'room/1' }),
    null
  );
});

test('gestão ativa pode convidar perfil ainda não membro', () => {
  const decision = evaluateCommunityInviteSend({
    communityOperational: true,
    actorStatus: 'active',
    actorRole: 'moderator',
    membersCanInvite: false,
    targetStatus: null,
    existingInviteStatus: null,
    existingInviteExpired: false,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.deduplicated, false);
});

test('membro comum só pode convidar quando a Comunidade habilita essa permissão', () => {
  const denied = evaluateCommunityInviteSend({
    communityOperational: true,
    actorStatus: 'active',
    actorRole: 'member',
    membersCanInvite: false,
    targetStatus: null,
    existingInviteStatus: null,
    existingInviteExpired: false,
  });
  const allowed = evaluateCommunityInviteSend({
    communityOperational: true,
    actorStatus: 'active',
    actorRole: 'member',
    membersCanInvite: true,
    targetStatus: null,
    existingInviteStatus: null,
    existingInviteExpired: false,
  });

  assert.equal(denied.allowed, false);
  assert.equal(denied.denialReason, 'inviter_not_allowed');
  assert.equal(allowed.allowed, true);
});

test('convite pendente válido é deduplicado', () => {
  const decision = evaluateCommunityInviteSend({
    communityOperational: true,
    actorStatus: 'active',
    actorRole: 'admin',
    membersCanInvite: false,
    targetStatus: 'left',
    existingInviteStatus: 'pending',
    existingInviteExpired: false,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.deduplicated, true);
});

test('não convida membro ativo nem vínculo bloqueado', () => {
  const active = evaluateCommunityInviteSend({
    communityOperational: true,
    actorStatus: 'active',
    actorRole: 'owner',
    membersCanInvite: false,
    targetStatus: 'active',
    existingInviteStatus: null,
    existingInviteExpired: false,
  });
  const blocked = evaluateCommunityInviteSend({
    communityOperational: true,
    actorStatus: 'active',
    actorRole: 'owner',
    membersCanInvite: false,
    targetStatus: 'blocked',
    existingInviteStatus: null,
    existingInviteExpired: false,
  });

  assert.equal(active.denialReason, 'target_already_member');
  assert.equal(blocked.denialReason, 'target_blocked');
});

test('aceitação ativa membership e incrementa métrica quando necessário', () => {
  const decision = evaluateCommunityInviteResponse({
    action: 'accept',
    inviteStatus: 'pending',
    inviteExpired: false,
    communityOperational: true,
    targetStatus: 'pending',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.nextInviteStatus, 'accepted');
  assert.equal(decision.activateMembership, true);
  assert.equal(decision.incrementMemberCount, true);
});

test('aceitação não duplica memberCount se membership já ficou ativa', () => {
  const decision = evaluateCommunityInviteResponse({
    action: 'accept',
    inviteStatus: 'pending',
    inviteExpired: false,
    communityOperational: true,
    targetStatus: 'active',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.activateMembership, false);
  assert.equal(decision.incrementMemberCount, false);
});

test('recusa não depende de Comunidade ainda estar operacional', () => {
  const decision = evaluateCommunityInviteResponse({
    action: 'decline',
    inviteStatus: 'pending',
    inviteExpired: false,
    communityOperational: false,
    targetStatus: null,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.nextInviteStatus, 'declined');
});

test('convite expirado não pode ser aceito', () => {
  const decision = evaluateCommunityInviteResponse({
    action: 'accept',
    inviteStatus: 'pending',
    inviteExpired: true,
    communityOperational: true,
    targetStatus: null,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'invite_expired');
});

test('remetente original pode revogar convite pendente', () => {
  const decision = evaluateCommunityInviteRevoke({
    actorStatus: 'left',
    actorRole: 'member',
    membersCanInvite: false,
    actorIsOriginalSender: true,
    inviteStatus: 'pending',
  });

  assert.equal(decision.allowed, true);
});

test('outro gestor ativo também pode revogar convite pendente', () => {
  const decision = evaluateCommunityInviteRevoke({
    actorStatus: 'active',
    actorRole: 'admin',
    membersCanInvite: false,
    actorIsOriginalSender: false,
    inviteStatus: 'pending',
  });

  assert.equal(decision.allowed, true);
});
