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
        }),
      ],
      nextCursor: 'community-venue-1',
      generatedAt: 100,
    });

    expect(page.items.map((item) => item.source.type)).toEqual([
      'community',
      'venue',
    ]);
    expect(page.items[0]?.access.minimumRole).toBe('premium');
    expect(page.items[0]?.access.requiresActiveSubscription).toBe(true);
    expect(page.nextCursor).toBe('community-venue-1');
  });

  it('remove Sala, cards malformados e URLs não HTTPS', () => {
    const page = normalizeCommunityDiscoveryPageResponse({
      items: [
        card({ communityId: '../invalid' }),
        card({
          communityId: 'community-room-1',
          slug: 'sala-legada',
          source: { type: 'room', id: 'room-1' },
        }),
        card({ avatarUrl: 'http://example.com/avatar.jpg' }),
      ],
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.avatarUrl).toBeNull();
  });

  it('normaliza a prévia, o papel próprio e rejeita viewerMode desconhecido', () => {
    const preview = normalizeCommunityPreviewResponse({
      community: card(),
      viewerMode: 'manager',
      viewerRole: 'owner',
      canInteract: true,
      generatedAt: 200,
    });

    expect(preview?.canInteract).toBe(true);
    expect(preview?.viewerRole).toBe('owner');

    expect(
      normalizeCommunityPreviewResponse({
        community: card(),
        viewerMode: 'root',
      })
    ).toBeNull();
  });

  it('não aceita papel próprio desconhecido', () => {
    expect(
      normalizeCommunityPreviewResponse({
        community: card(),
        viewerMode: 'manager',
        viewerRole: 'root',
      })?.viewerRole
    ).toBeNull();
  });
});
