import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityManagedMembersPage,
  normalizeCommunityManageMemberResponse,
} from './community-member-management.model';

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    assignableRoles: ['moderator', 'member'],
    canRemove: true,
    canBlock: true,
    canUnblock: false,
    ...overrides,
  };
}

describe('community member management normalization', () => {
  it('normaliza página administrativa, histórico de bloqueio e capabilities', () => {
    const page = normalizeCommunityManagedMembersPage({
      items: [
        {
          memberId: 'member-1',
          label: 'Pessoa Um',
          avatarUrl: 'https://example.test/avatar.webp',
          status: 'active',
          role: 'moderator',
          roleBeforeBlock: null,
          updatedAt: 100,
          capabilities: capabilities(),
        },
        {
          memberId: 'member-2',
          label: 'Pessoa Dois',
          avatarUrl: 'http://example.test/inseguro.webp',
          status: 'blocked',
          role: 'member',
          roleBeforeBlock: 'admin',
          updatedAt: 200,
          capabilities: capabilities({
            assignableRoles: ['root', 'member'],
            canRemove: false,
            canBlock: false,
            canUnblock: true,
          }),
        },
        {
          memberId: '../invalid',
          label: 'Inválido',
          status: 'active',
          role: 'root',
          roleBeforeBlock: null,
          updatedAt: 300,
          capabilities: capabilities(),
        },
      ],
      nextCursor: 'member-2',
      generatedAt: 400,
    });

    expect(page?.items).toHaveLength(2);
    expect(page?.items[0]?.role).toBe('moderator');
    expect(page?.items[0]?.capabilities.assignableRoles).toEqual([
      'moderator',
      'member',
    ]);
    expect(page?.items[1]?.avatarUrl).toBeNull();
    expect(page?.items[1]?.roleBeforeBlock).toBe('admin');
    expect(page?.items[1]?.capabilities.assignableRoles).toEqual(['member']);
    expect(page?.items[1]?.capabilities.canUnblock).toBe(true);
    expect(page?.nextCursor).toBe('member-2');
  });

  it('descarta item sem capabilities e rejeita histórico de papel inválido', () => {
    const page = normalizeCommunityManagedMembersPage({
      items: [
        {
          memberId: 'member-1',
          label: 'Sem capabilities',
          status: 'active',
          role: 'member',
          roleBeforeBlock: null,
          updatedAt: 100,
        },
        {
          memberId: 'member-2',
          label: 'Histórico inválido',
          status: 'blocked',
          role: 'member',
          roleBeforeBlock: 'owner',
          updatedAt: 100,
          capabilities: capabilities(),
        },
      ],
      nextCursor: null,
      generatedAt: 100,
    });

    expect(page?.items).toEqual([]);
  });

  it('rejeita cursor malformado e resposta de ação sem papel conhecido', () => {
    expect(
      normalizeCommunityManagedMembersPage({
        items: [],
        nextCursor: '../invalid',
        generatedAt: 100,
      })
    ).toBeNull();

    expect(
      normalizeCommunityManageMemberResponse({
        memberId: 'member-1',
        status: 'active',
        role: 'owner',
        generatedAt: 100,
      })
    ).toBeNull();
  });

  it('aceita resultado de mudança, bloqueio e remoção', () => {
    for (const status of ['active', 'blocked', 'left'] as const) {
      const result = normalizeCommunityManageMemberResponse({
        memberId: 'member-1',
        status,
        role: 'member',
        generatedAt: 100,
      });

      expect(result?.status).toBe(status);
      expect(result?.role).toBe('member');
    }
  });
});
