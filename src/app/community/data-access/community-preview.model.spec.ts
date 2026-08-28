// src/app/community/data-access/community-preview.model.spec.ts
import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityDiscoveryPageResponse,
  normalizeCommunityPreviewResponse,
} from './community-preview.model';

function card(overrides: Record<string, unknown> = {}) {
  return {
    communityId: 'community-1',
    name: 'Comunidade do Centro',
    slug: 'comunidade-do-centro',
    description: 'Grupo permanente de pessoas da região central.',
    source: { type: 'community', id: 'community-1' },
    avatarUrl: 'https://example.com/avatar.jpg',
    coverUrl: null,
    metrics: { memberCount: 8, postCount: 3, mediaCount: 2 },
    access: {
      join: 'approval',
      minimumRole: 'premium',
      requiresActiveSubscription: true,
    },
    tags: [
      { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
      { id: 'practice:bdsm', label: 'BDSM', category: 'practice' },
    ],
    ...overrides,
  };
}

describe('community preview normalization', () => {
  it('normaliza Comunidade e Local como origens distintas', () => {
    const page = normalizeCommunityDiscoveryPageResponse({
      items: [
        card(),
        card({
          communityId: 'community-venue-1',
          slug: 'local-centro',
          source: { type: 'venue', id: 'venue-1' },
          tags: [],
        }),
      ],
      nextCursor: 'community-venue-1',
      generatedAt: 100,
    });

    expect(page.items.map((item) => item.source.type)).toEqual([
      'community',
      'venue',
    ]);
    expect(page.items[0]?.access.minimumRole).toBeNull();
    expect(page.items[0]?.access.requiresActiveSubscription).toBe(false);
    expect(page.items[0]?.tags.map((tag) => tag.id)).toEqual([
      'intent:friendship',
      'practice:bdsm',
    ]);
    expect(page.nextCursor).toBe('community-venue-1');
  });

  it('normaliza papel válido em card privado e descarta papel desconhecido', () => {
    const page = normalizeCommunityDiscoveryPageResponse({
      items: [
        card({ viewerRole: 'owner' }),
        card({
          communityId: 'community-2',
          slug: 'comunidade-dois',
          source: { type: 'community', id: 'community-2' },
          viewerRole: 'root',
        }),
      ],
    });

    expect(page.items[0]?.viewerRole).toBe('owner');
    expect(page.items[1]?.viewerRole).toBeUndefined();
  });

  it('remove Sala, cards malformados, tags inválidas e URLs não HTTPS', () => {
    const page = normalizeCommunityDiscoveryPageResponse({
      items: [
        card({ communityId: '../invalid' }),
        card({
          communityId: 'community-room-1',
          slug: 'sala-legada',
          source: { type: 'room', id: 'room-1' },
        }),
        card({
          avatarUrl: 'http://example.com/avatar.jpg',
          tags: [
            { id: '../invalid', label: 'Inválida', category: 'intent' },
            { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
            { id: 'practice:bdsm', label: '', category: 'practice' },
          ],
        }),
      ],
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.avatarUrl).toBeNull();
    expect(page.items[0]?.tags).toEqual([
      { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
    ]);
  });

  it('normaliza a prévia, o papel próprio e capabilities booleanas do backend', () => {
    const preview = normalizeCommunityPreviewResponse({
      community: card(),
      rules: ' Respeite os participantes.\r\n\r\n Preserve a privacidade. ',
      lifecycleStatus: 'active',
      viewerMode: 'manager',
      viewerRole: 'owner',
      canInteract: true,
      canManageMemberships: true,
      canInviteCommunityMembers: true,
      canManageCommunitySettings: true,
      capacity: {
        configuredLimit: 250,
        effectiveLimit: 250,
        memberCount: 8,
        acceptingNewMembers: true,
        restrictedByOwnerPlan: false,
        allowedMemberLimits: [25, 50, 100, 250],
      },
      settings: {
        name: 'Comunidade do Centro',
        description: 'Grupo permanente de pessoas da região central.',
        rules: 'Respeite os participantes.',
        joinPolicy: 'approval',
        accessTier: 'premium',
        membersCanInvite: false,
        memberLimit: 250,
        tagIds: ['intent:friendship', 'practice:bdsm'],
      },
      canLeaveMembership: true,
      generatedAt: 200,
    });

    expect(preview?.canInteract).toBe(true);
    expect(preview?.canManageMemberships).toBe(true);
    expect(preview?.canInviteCommunityMembers).toBe(true);
    expect(preview?.canManageCommunitySettings).toBe(true);
    expect(preview?.settings).not.toHaveProperty('accessTier');
    expect(preview?.capacity?.configuredLimit).toBe(250);
    expect(preview?.canLeaveMembership).toBe(true);
    expect(preview?.viewerRole).toBe('owner');
    expect(preview?.community.tags).toHaveLength(2);
    expect(preview?.rules).toBe(
      'Respeite os participantes.\nPreserve a privacidade.'
    );
    expect(preview?.lifecycleStatus).toBe('active');

    const failClosed = normalizeCommunityPreviewResponse({
      community: card(),
      rules: 'Respeite os participantes.',
      lifecycleStatus: 'active',
      viewerMode: 'manager',
      viewerRole: 'owner',
    });
    expect(failClosed?.canInteract).toBe(false);
    expect(failClosed?.canManageMemberships).toBe(false);
    expect(failClosed?.canInviteCommunityMembers).toBe(false);
    expect(failClosed?.canManageCommunitySettings).toBe(false);
    expect(failClosed?.settings).toBeNull();
    expect(failClosed?.capacity).toEqual({
      configuredLimit: 25,
      effectiveLimit: 25,
      memberCount: 8,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: false,
      allowedMemberLimits: [],
    });
    expect(failClosed?.canLeaveMembership).toBe(false);
  });

  it('rejeita configurações privadas malformadas quando a capability é concedida', () => {
    expect(normalizeCommunityPreviewResponse({
      community: card(),
      rules: 'Respeite os participantes.',
      lifecycleStatus: 'active',
      viewerMode: 'manager',
      viewerRole: 'owner',
      canManageCommunitySettings: true,
      settings: { name: 'Incompleta' },
    })).toBeNull();
  });

  it('rejeita capacidade comunitária explícita malformada', () => {
    expect(normalizeCommunityPreviewResponse({
      community: card(),
      lifecycleStatus: 'active',
      viewerMode: 'visitor',
      capacity: {
        configuredLimit: 90,
        effectiveLimit: 25,
        memberCount: 8,
      },
    })).toBeNull();
  });

  it('rejeita viewerMode desconhecido', () => {
    expect(
      normalizeCommunityPreviewResponse({
        community: card(),
        lifecycleStatus: 'active',
        viewerMode: 'root',
      })
    ).toBeNull();
  });

  it('não aceita papel próprio desconhecido', () => {
    expect(
      normalizeCommunityPreviewResponse({
        community: card(),
        lifecycleStatus: 'active',
        viewerMode: 'manager',
        viewerRole: 'root',
      })?.viewerRole
    ).toBeNull();
  });

  it('rejeita lifecycle comunitário desconhecido e isola detalhes de Local', () => {
    expect(
      normalizeCommunityPreviewResponse({
        community: card(),
        lifecycleStatus: 'unknown',
        viewerMode: 'visitor',
      })
    ).toBeNull();

    const venue = normalizeCommunityPreviewResponse({
      community: card({
        communityId: 'community-venue-1',
        slug: 'local-centro',
        source: { type: 'venue', id: 'venue-1' },
        tags: [],
      }),
      rules: 'Não deve aparecer no Local.',
      lifecycleStatus: 'archived',
      viewerMode: 'visitor',
    });

    expect(venue?.rules).toBeNull();
    expect(venue?.lifecycleStatus).toBeNull();
  });
});
