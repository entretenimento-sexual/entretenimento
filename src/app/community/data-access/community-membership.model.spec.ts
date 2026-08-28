import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityMembershipRequestsResponse,
  normalizeCommunityMembershipResponse,
  normalizeCommunityMembershipReviewResponse,
} from './community-membership.model';

describe('normalizeCommunityMembershipResponse', () => {
  it('normaliza entrada ativa', () => {
    expect(
      normalizeCommunityMembershipResponse({
        status: 'active',
        viewerMode: 'member',
        canInteract: true,
      })
    ).toEqual({
      status: 'active',
      viewerMode: 'member',
      canInteract: true,
    });
  });

  it('normaliza solicitação pendente sem interação', () => {
    expect(
      normalizeCommunityMembershipResponse({
        status: 'pending',
        viewerMode: 'pending',
        canInteract: true,
      })
    ).toEqual({
      status: 'pending',
      viewerMode: 'pending',
      canInteract: false,
    });
  });

  it('normaliza saída como visitante sem interação', () => {
    expect(
      normalizeCommunityMembershipResponse({
        status: 'left',
        viewerMode: 'visitor',
        canInteract: true,
      })
    ).toEqual({
      status: 'left',
      viewerMode: 'visitor',
      canInteract: false,
    });
  });

  it('descarta combinações inconsistentes', () => {
    expect(
      normalizeCommunityMembershipResponse({
        status: 'active',
        viewerMode: 'pending',
      })
    ).toBeNull();
    expect(normalizeCommunityMembershipResponse({ status: 'blocked' })).toBeNull();
  });
});

describe('normalizeCommunityMembershipRequestsResponse', () => {
  it('sanitiza, ordena e limita solicitações', () => {
    expect(
      normalizeCommunityMembershipRequestsResponse({
        items: [
          {
            memberId: 'member-1',
            label: ' Pessoa Um ',
            avatarUrl: 'http://unsafe.example/avatar.jpg',
            requestedAt: 100,
          },
          {
            memberId: 'member-2',
            label: 'Pessoa Dois',
            avatarUrl: 'https://example.com/avatar.jpg',
            requestedAt: 200,
          },
          {
            memberId: '../unsafe',
            label: 'Inválido',
            requestedAt: 300,
          },
        ],
        generatedAt: 400,
      })
    ).toEqual({
      items: [
        {
          memberId: 'member-2',
          label: 'Pessoa Dois',
          avatarUrl: 'https://example.com/avatar.jpg',
          requestedAt: 200,
        },
        {
          memberId: 'member-1',
          label: 'Pessoa Um',
          avatarUrl: null,
          requestedAt: 100,
        },
      ],
      generatedAt: 400,
    });
  });

  it('descarta resposta estruturalmente inválida', () => {
    expect(
      normalizeCommunityMembershipRequestsResponse({ items: [], generatedAt: 0 })
    ).toBeNull();
  });
});

describe('normalizeCommunityMembershipReviewResponse', () => {
  it('aceita aprovação e rejeição coerentes', () => {
    expect(
      normalizeCommunityMembershipReviewResponse({
        memberId: 'member-1',
        status: 'active',
        viewerMode: 'member',
      })
    ).toEqual({
      memberId: 'member-1',
      status: 'active',
      viewerMode: 'member',
    });

    expect(
      normalizeCommunityMembershipReviewResponse({
        memberId: 'member-2',
        status: 'left',
        viewerMode: 'visitor',
      })
    ).toEqual({
      memberId: 'member-2',
      status: 'left',
      viewerMode: 'visitor',
    });
  });

  it('descarta membro ou combinação inseguros', () => {
    expect(
      normalizeCommunityMembershipReviewResponse({
        memberId: '../unsafe',
        status: 'active',
        viewerMode: 'member',
      })
    ).toBeNull();
    expect(
      normalizeCommunityMembershipReviewResponse({
        memberId: 'member-1',
        status: 'left',
        viewerMode: 'member',
      })
    ).toBeNull();
  });
});
