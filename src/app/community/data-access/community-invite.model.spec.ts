// src/app/community/data-access/community-invite.model.spec.ts
import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityInviteCandidateResponse,
  normalizeCommunityInviteInbox,
  normalizeCommunityInviteResult,
  normalizeCommunitySentInvitesResponse,
} from './community-invite.model';

describe('Community invite client contracts', () => {
  it('normaliza inbox sanitizado e descarta avatar não HTTPS', () => {
    expect(
      normalizeCommunityInviteInbox({
        generatedAt: 1_787_000_000_000,
        items: [
          {
            inviteId: 'community:community-1:to:user-1',
            communityId: 'community-1',
            communityName: 'Comunidade Um',
            senderId: 'sender-1',
            senderLabel: 'Perfil',
            senderAvatarUrl: 'http://example.com/avatar.jpg',
            sentAt: 1_787_000_000_000,
            expiresAt: 1_787_604_800_000,
          },
        ],
      })
    ).toEqual({
      generatedAt: 1_787_000_000_000,
      items: [
        {
          inviteId: 'community:community-1:to:user-1',
          communityId: 'community-1',
          communityName: 'Comunidade Um',
          senderId: 'sender-1',
          senderLabel: 'Perfil',
          senderAvatarUrl: null,
          sentAt: 1_787_000_000_000,
          expiresAt: 1_787_604_800_000,
        },
      ],
    });
  });

  it('descarta item malformado sem invalidar os demais convites', () => {
    const result = normalizeCommunityInviteInbox({
      generatedAt: 1_787_000_000_000,
      items: [
        {
          inviteId: '../unsafe',
          communityId: 'community-1',
          communityName: 'Inválida',
          senderId: 'sender-1',
          senderLabel: 'Perfil',
          sentAt: 1,
          expiresAt: 2,
        },
        {
          inviteId: 'community:community-2:to:user-1',
          communityId: 'community-2',
          communityName: 'Válida',
          senderId: 'sender-2',
          senderLabel: 'Outro perfil',
          senderAvatarUrl: 'https://example.com/avatar.jpg',
          sentAt: 1_787_000_000_000,
          expiresAt: 1_787_604_800_000,
        },
      ],
    });

    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.communityId).toBe('community-2');
  });

  it('normaliza somente resultado de ação com IDs e status válidos', () => {
    expect(
      normalizeCommunityInviteResult({
        inviteId: 'community:community-1:to:user-1',
        communityId: 'community-1',
        receiverId: 'user-1',
        status: 'accepted',
        deduplicated: true,
      })
    ).toEqual({
      inviteId: 'community:community-1:to:user-1',
      communityId: 'community-1',
      receiverId: 'user-1',
      status: 'accepted',
      deduplicated: true,
    });

    expect(
      normalizeCommunityInviteResult({
        inviteId: 'community:community-1:to:user-1',
        communityId: '../unsafe',
        receiverId: 'user-1',
        status: 'accepted',
      })
    ).toBeNull();
  });

  it('normaliza candidato exato e permite resultado sem perfil disponível', () => {
    expect(normalizeCommunityInviteCandidateResponse({
      candidate: {
        userId: 'user-1',
        nickname: 'Pessoa Segura',
        avatarUrl: 'https://example.com/avatar.jpg',
        status: 'eligible',
      },
      generatedAt: 100,
    })).toEqual({
      candidate: {
        userId: 'user-1',
        nickname: 'Pessoa Segura',
        avatarUrl: 'https://example.com/avatar.jpg',
        status: 'eligible',
      },
      generatedAt: 100,
    });
    expect(normalizeCommunityInviteCandidateResponse({
      candidate: null,
      generatedAt: 100,
    })).toEqual({ candidate: null, generatedAt: 100 });
    expect(normalizeCommunityInviteCandidateResponse({
      candidate: { userId: 'user-1', status: 'unknown' },
      generatedAt: 100,
    })).toBeNull();
  });

  it('normaliza convites pendentes enviados e descarta itens inseguros', () => {
    const result = normalizeCommunitySentInvitesResponse({
      generatedAt: 100,
      items: [
        {
          inviteId: 'community:community-1:to:user-1',
          receiverId: 'user-1',
          receiverLabel: 'Pessoa Um',
          receiverAvatarUrl: 'http://example.com/inseguro.jpg',
          senderId: 'owner-1',
          senderLabel: 'Você',
          sentAt: 90,
          expiresAt: 200,
        },
        {
          inviteId: '../unsafe',
          receiverId: 'user-2',
          receiverLabel: 'Pessoa Dois',
          senderId: 'owner-1',
          senderLabel: 'Você',
          sentAt: 90,
          expiresAt: 200,
        },
      ],
    });

    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.receiverAvatarUrl).toBeNull();
  });
});
