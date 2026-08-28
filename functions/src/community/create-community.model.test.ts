// functions/src/community/create-community.model.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCommunityTagCatalog,
  resolveCommunityTagDefinitions,
} from './community-tag.catalog';
import { normalizeCreateCommunityRequest } from './create-community.model';

const VALID_REQUEST_ID = '8d7fb4a1-91e5-4dbf-9cc7-42fd4d77f771';
const VALID_TAGS = ['intent:friendship', 'practice:bdsm'] as const;

test('normaliza uma Comunidade e deriva o ID controlado pelo backend', () => {
  const result = normalizeCreateCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: '  Conexões Áureas RJ  ',
    theme: 'regional',
    description: '  Pessoas com interesses em comum. ',
    rules: ' Respeito é obrigatório.\nNão exponha outros membros. ',
    joinPolicy: 'open',
    accessTier: 'premium',
    memberLimit: 250,
    tagIds: [...VALID_TAGS],
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
    accessTier: 'all',
    memberLimit: 250,
    tagIds: [...VALID_TAGS],
  });
});

test('usa aprovação e acesso geral como padrões conservadores', () => {
  const result = normalizeCreateCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: 'Comunidade Teste',
    theme: 'interests',
    rules: 'Respeite os demais participantes.',
    tagIds: ['intent:friendship'],
  });

  assert.equal(result?.joinPolicy, 'approval');
  assert.equal(result?.accessTier, 'all');
  assert.equal(result?.memberLimit, 25);
  assert.equal(result?.description, null);
});

test('ignora paywall enviado por cliente antigo e mantém participação gratuita', () => {
  const result = normalizeCreateCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: 'Comunidade sem Paywall',
    theme: 'interests',
    rules: 'Respeite os demais participantes.',
    accessTier: 'vip',
    tagIds: ['intent:friendship'],
  });

  assert.equal(result?.accessTier, 'all');
});

test('reordena, deduplica e mantém somente IDs canônicos conhecidos', () => {
  const result = normalizeCreateCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: 'Comunidade Tags',
    theme: 'interests',
    rules: 'Respeite os demais participantes.',
    tagIds: ['practice:bdsm', 'intent:friendship', 'practice:bdsm'],
  });

  assert.deepEqual(result?.tagIds, [
    'intent:friendship',
    'practice:bdsm',
  ]);
});

test('expõe Swing uma única vez sem perder correlação com intenção e prática', () => {
  const swingTags = getCommunityTagCatalog().filter((tag) => tag.label === 'Swing');

  assert.equal(swingTags.length, 1);
  assert.equal(swingTags[0]?.id, 'intent:swing');
  assert.deepEqual(swingTags[0]?.preferenceSignals, [
    { domain: 'relationshipIntent', key: 'swing' },
    { domain: 'sexualPractice', key: 'swing' },
  ]);
  assert.deepEqual(resolveCommunityTagDefinitions(['intent:swing']), swingTags);
  assert.deepEqual(resolveCommunityTagDefinitions(['practice:swing']), []);
});

test('rejeita ausência, excesso ou ID de tag desconhecido', () => {
  assert.equal(
    normalizeCreateCommunityRequest({
      requestId: VALID_REQUEST_ID,
      name: 'Sem Tags',
      theme: 'interests',
      rules: 'Respeite os demais participantes.',
      tagIds: [],
    }),
    null
  );

  assert.equal(
    normalizeCreateCommunityRequest({
      requestId: VALID_REQUEST_ID,
      name: 'Tag Inválida',
      theme: 'interests',
      rules: 'Respeite os demais participantes.',
      tagIds: ['practice:inexistente'],
    }),
    null
  );

  assert.equal(
    normalizeCreateCommunityRequest({
      requestId: VALID_REQUEST_ID,
      name: 'Tags Demais',
      theme: 'interests',
      rules: 'Respeite os demais participantes.',
      tagIds: [
        'intent:friendship',
        'intent:casual',
        'intent:dating',
        'intent:serious',
        'intent:open_relationship',
        'intent:polyamory',
        'intent:swing',
      ],
    }),
    null
  );
});

test('rejeita requestId, nome, tema ou regras inválidos', () => {
  assert.equal(
    normalizeCreateCommunityRequest({
      requestId: 'placeholder',
      name: 'Comunidade',
      theme: 'interests',
      rules: 'Respeite todos.',
      tagIds: ['intent:friendship'],
    }),
    null
  );

  assert.equal(
    normalizeCreateCommunityRequest({
      requestId: VALID_REQUEST_ID,
      name: 'A',
      theme: 'invalid',
      rules: 'curta',
      tagIds: ['intent:friendship'],
    }),
    null
  );
});

test('rejeita capacidade fora das faixas canônicas', () => {
  assert.equal(
    normalizeCreateCommunityRequest({
      requestId: VALID_REQUEST_ID,
      name: 'Comunidade sem teto seguro',
      theme: 'interests',
      rules: 'Respeite os demais participantes.',
      memberLimit: 90,
      tagIds: ['intent:friendship'],
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
    tagIds: ['audience:couple_mf'],
    communityId: 'community-forjada',
    ownerUid: 'outro-usuario',
    moderation: { state: 'active' },
  } as Record<string, unknown>);

  assert.equal(result?.communityId, `community-${VALID_REQUEST_ID}`);
  assert.equal('ownerUid' in (result ?? {}), false);
  assert.equal('moderation' in (result ?? {}), false);
});
