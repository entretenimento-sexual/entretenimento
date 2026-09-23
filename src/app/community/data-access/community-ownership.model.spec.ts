import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityOwnershipCandidatesResponse,
  normalizeCommunityOwnershipInboxResponse,
  normalizeCommunityOwnershipTransferActionResponse,
  normalizeCommunityOwnershipTransferResponse,
} from './community-ownership.model';

describe('community ownership model', () => {
  it('preserva cursor válido para continuar a busca de sucessores', () => {
    const result = normalizeCommunityOwnershipCandidatesResponse({
      items: [
        {
          uid: 'member-1',
          label: 'Pessoa Um',
          avatarUrl: null,
          role: 'member',
        },
      ],
      nextCursor: 'member-050',
      generatedAt: 1,
    });

    expect(result?.nextCursor).toBe('member-050');
    expect(result?.items).toHaveLength(1);
  });

  it('aceita fim de paginação explícito', () => {
    const result = normalizeCommunityOwnershipCandidatesResponse({
      items: [],
      nextCursor: null,
      generatedAt: 1,
    });

    expect(result?.nextCursor).toBeNull();
  });

  it('falha fechado quando o backend devolve cursor inválido', () => {
    expect(
      normalizeCommunityOwnershipCandidatesResponse({
        items: [],
        nextCursor: 'cursor inválido',
        generatedAt: 1,
      })
    ).toBeNull();
  });

  it('normaliza oferta pendente sem tratá-la como transferência concluída', () => {
    const result = normalizeCommunityOwnershipTransferResponse({
      requestId: 'transfer:1',
      communityId: 'community-1',
      candidateUid: 'member-1',
      status: 'pending',
      mode: 'voluntary',
      expiresAt: 2_000,
      generatedAt: 1_000,
    });

    expect(result?.status).toBe('pending');
    expect(result?.candidateUid).toBe('member-1');
  });

  it('normaliza caixa de entrada e resposta explícita', () => {
    const inbox = normalizeCommunityOwnershipInboxResponse({
      incoming: [{
        requestId: 'transfer:1',
        communityId: 'community-1',
        communityName: 'Comunidade',
        previousOwnerUid: 'owner-1',
        previousOwnerLabel: 'Owner',
        candidateUid: 'member-1',
        candidateLabel: 'Member',
        mode: 'voluntary',
        status: 'pending',
        expiresAt: 2_000,
        createdAt: 1_000,
      }],
      outgoing: [],
      generatedAt: 1_000,
    });
    const action = normalizeCommunityOwnershipTransferActionResponse({
      requestId: 'transfer:1',
      communityId: 'community-1',
      status: 'completed',
      newOwnerUid: 'member-1',
      generatedAt: 2_000,
    });

    expect(inbox?.incoming).toHaveLength(1);
    expect(action?.status).toBe('completed');
    expect(action?.newOwnerUid).toBe('member-1');
  });
});
