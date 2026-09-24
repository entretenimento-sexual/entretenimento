import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCommunityMemberManagementIndexProjection,
  buildCommunityMemberManagementSearchIdentity,
  buildCommunityMemberManagementSearchPrefixes,
  communityMemberManagementSearchIdentityEquals,
  decodeCommunityMemberManagementCursor,
  encodeCommunityMemberManagementCursor,
  matchesCommunityMemberManagementRoleFilter,
  normalizeCommunityMemberManagementSearchQuery,
} from './community-member-management-index.policy';

describe('community member management index policy', () => {
  it('detecta quando write de usuário não altera identidade pesquisável', () => {
    const before = buildCommunityMemberManagementSearchIdentity({
      nickname: 'João Silva',
      avatarUrl: 'https://example.test/avatar.webp',
      bio: 'antes',
    });
    const unrelatedWrite = buildCommunityMemberManagementSearchIdentity({
      nickname: 'João Silva',
      avatarUrl: 'https://example.test/avatar.webp',
      bio: 'depois',
    });
    const renamed = buildCommunityMemberManagementSearchIdentity({
      nickname: 'João Souza',
      avatarUrl: 'https://example.test/avatar.webp',
    });

    assert.equal(
      communityMemberManagementSearchIdentityEquals(before, unrelatedWrite),
      true
    );
    assert.equal(
      communityMemberManagementSearchIdentityEquals(before, renamed),
      false
    );
  });

  it('normaliza busca com acento, caixa e prefixos por palavra', () => {
    assert.equal(
      normalizeCommunityMemberManagementSearchQuery('  João   SILVA '),
      'joao silva'
    );

    const prefixes = buildCommunityMemberManagementSearchPrefixes('João Silva');
    assert.ok(prefixes.includes('jo'));
    assert.ok(prefixes.includes('joao si'));
    assert.ok(prefixes.includes('si'));
    assert.ok(prefixes.includes('silva'));
  });

  it('rejeita busca de um único caractere e aceita consulta vazia', () => {
    assert.equal(normalizeCommunityMemberManagementSearchQuery(''), '');
    assert.equal(normalizeCommunityMemberManagementSearchQuery('j'), null);
  });

  it('usa papel anterior no filtro administrativo de bloqueados', () => {
    const projection = buildCommunityMemberManagementIndexProjection({
      communityId: 'community-1',
      memberId: 'member-1',
      rawMembership: {
        status: 'blocked',
        role: 'member',
        blockedPreviousRole: 'admin',
      },
      rawUser: {
        nickname: 'Pessoa Um',
        avatarUrl: 'https://example.test/avatar.webp',
      },
    });

    assert.equal(projection?.managementRole, 'admin');
    assert.equal(projection?.leadership, true);
    assert.equal(projection?.status, 'blocked');
  });

  it('não projeta pendentes/left e nunca fabrica papel', () => {
    assert.equal(
      buildCommunityMemberManagementIndexProjection({
        communityId: 'community-1',
        memberId: 'member-1',
        rawMembership: { status: 'pending', role: 'member' },
        rawUser: { nickname: 'Pessoa Um' },
      }),
      null
    );

    assert.equal(
      buildCommunityMemberManagementIndexProjection({
        communityId: 'community-1',
        memberId: 'member-1',
        rawMembership: { status: 'active', role: 'root' },
        rawUser: { nickname: 'Pessoa Um' },
      }),
      null
    );
  });

  it('serializa cursor opaco e preserva ordenação composta', () => {
    const encoded = encodeCommunityMemberManagementCursor({
      sortLabel: 'pessoa um',
      documentId: 'community-1:member-1',
    });

    assert.ok(encoded.startsWith('v1_'));
    assert.deepEqual(decodeCommunityMemberManagementCursor(encoded), {
      sortLabel: 'pessoa um',
      documentId: 'community-1:member-1',
    });
  });

  it('resolve shortlist de liderança sem promover owner/member', () => {
    assert.equal(
      matchesCommunityMemberManagementRoleFilter('admin', 'leadership'),
      true
    );
    assert.equal(
      matchesCommunityMemberManagementRoleFilter('moderator', 'leadership'),
      true
    );
    assert.equal(
      matchesCommunityMemberManagementRoleFilter('member', 'leadership'),
      false
    );
    assert.equal(
      matchesCommunityMemberManagementRoleFilter('owner', 'leadership'),
      false
    );
  });
});
