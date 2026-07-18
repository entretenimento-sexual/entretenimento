// src/app/core/community/community-access-policy.spec.ts
import { describe, expect, it } from 'vitest';

import type {
  CommunityMemberRole,
  CommunityMemberStatus,
  ICommunity,
  ICommunityMembership,
} from './community.model';
import { resolveCommunityViewerCapabilities } from './community-access-policy';

function buildCommunity(overrides: Partial<ICommunity> = {}): ICommunity {
  return {
    id: 'community-1',
    name: 'Comunidade de teste',
    slug: 'comunidade-de-teste',
    source: { type: 'venue', id: 'venue-1' },
    status: 'active',
    visibility: 'public_preview',
    access: {
      preview: 'authenticated',
      interaction: 'members_only',
      join: 'approval',
    },
    moderation: { state: 'active' },
    metrics: { memberCount: 4, postCount: 3, mediaCount: 2 },
    ...overrides,
  };
}

function buildMembership(
  role: CommunityMemberRole = 'member',
  status: CommunityMemberStatus = 'active'
): ICommunityMembership {
  return {
    communityId: 'community-1',
    uid: 'user-1',
    role,
    status,
  };
}

describe('resolveCommunityViewerCapabilities', () => {
  it('permite prévia pública ao visitante autenticado sem liberar interação', () => {
    const decision = resolveCommunityViewerCapabilities(buildCommunity(), null);

    expect(decision.mode).toBe('visitor');
    expect(decision.canPreview).toBe(true);
    expect(decision.canInteract).toBe(false);
    expect(decision.canRequestMembership).toBe(true);
  });

  it('nega qualquer capacidade ao visitante sem autenticação', () => {
    const decision = resolveCommunityViewerCapabilities(
      buildCommunity(),
      null,
      false
    );

    expect(decision.canPreview).toBe(false);
    expect(decision.canRequestMembership).toBe(false);
  });

  it('libera interação somente para membro ativo', () => {
    const decision = resolveCommunityViewerCapabilities(
      buildCommunity({ visibility: 'members_only' }),
      buildMembership()
    );

    expect(decision.mode).toBe('member');
    expect(decision.canPreview).toBe(true);
    expect(decision.canInteract).toBe(true);
  });

  it('mantém membership pendente sem interação', () => {
    const decision = resolveCommunityViewerCapabilities(
      buildCommunity(),
      buildMembership('member', 'pending')
    );

    expect(decision.mode).toBe('pending');
    expect(decision.canPreview).toBe(true);
    expect(decision.canInteract).toBe(false);
    expect(decision.canRequestMembership).toBe(false);
  });

  it('bloqueia completamente membership marcada como blocked', () => {
    const decision = resolveCommunityViewerCapabilities(
      buildCommunity(),
      buildMembership('member', 'blocked')
    );

    expect(decision.mode).toBe('blocked');
    expect(decision.canPreview).toBe(false);
    expect(decision.canInteract).toBe(false);
  });

  it('libera moderação para moderador ativo sem conceder gestão', () => {
    const decision = resolveCommunityViewerCapabilities(
      buildCommunity(),
      buildMembership('moderator')
    );

    expect(decision.mode).toBe('moderator');
    expect(decision.canModerate).toBe(true);
    expect(decision.canManage).toBe(false);
  });

  it('libera gestão para owner ou admin ativo', () => {
    const ownerDecision = resolveCommunityViewerCapabilities(
      buildCommunity(),
      buildMembership('owner')
    );
    const adminDecision = resolveCommunityViewerCapabilities(
      buildCommunity(),
      buildMembership('admin')
    );

    expect(ownerDecision.canManage).toBe(true);
    expect(adminDecision.canManage).toBe(true);
  });

  it('não permite solicitação quando a entrada é somente por convite', () => {
    const decision = resolveCommunityViewerCapabilities(
      buildCommunity({
        access: {
          preview: 'authenticated',
          interaction: 'members_only',
          join: 'invite_only',
        },
      }),
      null
    );

    expect(decision.canPreview).toBe(true);
    expect(decision.canRequestMembership).toBe(false);
  });

  it('não libera interação quando a comunidade está pausada', () => {
    const decision = resolveCommunityViewerCapabilities(
      buildCommunity({ status: 'paused' }),
      buildMembership('member')
    );

    expect(decision.canPreview).toBe(true);
    expect(decision.canInteract).toBe(false);
  });
});
