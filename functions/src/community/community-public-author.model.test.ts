import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PRIVATE_DISCOVERY_INTEREST_FIELDS,
} from '../discovery/public-profile-discovery-projection';
import { buildPublicUserIdentity } from '../identity/public-user-identity.model';
import {
  buildCommunityPublicAuthor,
} from './community-public-author.model';

const PROFILE_ID = 'profile-00000000-0000-4000-8000-000000000001';
const cleanProfile = {
  profileId: PROFILE_ID,
  nickname: 'Autora Publica',
  identityCode: 'mulher',
  municipio: 'Rio de Janeiro',
  estado: 'RJ',
};
const legacyFallback = {
  label: 'Apelido Antigo Nunca Exibir',
  avatarUrl: 'https://example.org/antigo-avatar.jpg',
};

const neutralAuthor = buildPublicUserIdentity(null, {
  label: 'Participante',
  avatarUrl: null,
});

describe('Issue #236: identidade do autor no mural e comentarios', () => {
  it('mantem identidade e fallback canonicos para perfil limpo', () => {
    const result = buildCommunityPublicAuthor(cleanProfile, legacyFallback);
    assert.deepEqual(result, buildPublicUserIdentity(cleanProfile, legacyFallback));
    assert.equal(result.profileId, PROFILE_ID);
    assert.equal(result.nickname, 'Autora Publica');
  });

  it('nao altera o comportamento historico de fallback sem perfil', () => {
    const result = buildCommunityPublicAuthor(null, legacyFallback);
    assert.deepEqual(result, buildPublicUserIdentity(null, legacyFallback));
  });

  it('anonimiza as 21 chaves privadas mesmo quando o valor e null', () => {
    assert.equal(PRIVATE_DISCOVERY_INTEREST_FIELDS.length, 21);
    for (const field of PRIVATE_DISCOVERY_INTEREST_FIELDS) {
      for (const value of [null, ['SENTINEL_PRIVATE_INTEREST']]) {
        const rawProfile = { ...cleanProfile, [field]: value };
        const before = JSON.stringify(rawProfile);
        const result = buildCommunityPublicAuthor(rawProfile, legacyFallback);
        assert.deepEqual(result, neutralAuthor, `quarentena ausente: ${field}`);
        assert.equal(JSON.stringify(rawProfile), before, `mutacao indevida: ${field}`);
        const serialized = JSON.stringify(result);
        assert.ok(!serialized.includes(PROFILE_ID), `ID exposto: ${field}`);
        assert.ok(!serialized.includes('Autora Publica'), `nome exposto: ${field}`);
        assert.ok(!serialized.includes('Apelido Antigo'), `fallback exposto: ${field}`);
        assert.ok(!serialized.includes('antigo-avatar'), `avatar exposto: ${field}`);
        assert.ok(!serialized.includes('SENTINEL_PRIVATE_INTEREST'), `segredo exposto: ${field}`);
      }
    }
  });

  it('campos publicos estranhos a lista nao acionam quarentena', () => {
    const result = buildCommunityPublicAuthor(
      { ...cleanProfile, publicDescription: 'descricao aprovada' },
      legacyFallback
    );
    assert.equal(result.profileId, PROFILE_ID);
  });
});
