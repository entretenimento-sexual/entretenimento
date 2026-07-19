// functions/src/community/create-community.model.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCreateCommunityRequest } from './create-community.model';

const VALID_REQUEST_ID = '8d7fb4a1-91e5-4dbf-9cc7-42fd4d77f771';

test('normaliza uma Comunidade e deriva o ID controlado pelo backend', () => {
  const result = normalizeCreateCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: '  Conexões Áureas RJ  ',
    theme: 'regional',
    description: '  Pessoas com interesses em comum. ',
    rules: ' Respeito é obrigatório.\nNão exponha outros membros. ',
    joinPolicy: 'open',
    accessTier: 'premium',
  });

  assert.deepEqual(result, {
    requestId: VALID_REQUEST_ID,
    communityId: `community-${VALID_REQUEST_ID}`,
    name: 'Conexões Áureas RJ',
    slug: 'conexoes-aureas-rj',
    theme: 'regional',
    description: 'Pessoas com interesses em comum.',
    rules: 'Respeito é obrigatório.\nNão exponha outros membros.',
    joinPolicy: 'open',
    accessTier: 'premium',
  });
});

test('usa aprovação e acesso geral como padrões conservadores', () => {
  const result = normalizeCreateCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: 'Comunidade Teste',
    theme: 'interests',
    rules: 'Respeite os demais participantes.',
  });

  assert.equal(result?.joinPolicy, 'approval');
  assert.equal(result?.accessTier, 'all');
  assert.equal(result?.description, null);
});

test('rejeita requestId, nome, tema ou regras inválidos', () => {
  assert.equal(
    normalizeCreateCommunityRequest({
      requestId: 'placeholder',
      name: 'Comunidade',
      theme: 'interests',
      rules: 'Respeite todos.',
    }),
    null
  );

  assert.equal(
    normalizeCreateCommunityRequest({
      requestId: VALID_REQUEST_ID,
      name: 'A',
      theme: 'invalid',
      rules: 'curta',
    }),
    null
  );
});

test('não aceita ID, owner ou moderação enviados pelo cliente', () => {
  const result = normalizeCreateCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: 'Comunidade Segura',
    theme: 'identity',
    rules: 'Proteja a privacidade dos participantes.',
    communityId: 'community-forjada',
    ownerUid: 'outro-usuario',
    moderation: { state: 'active' },
  } as Record<string, unknown>);

  assert.equal(result?.communityId, `community-${VALID_REQUEST_ID}`);
  assert.equal('ownerUid' in (result ?? {}), false);
  assert.equal('moderation' in (result ?? {}), false);
});
