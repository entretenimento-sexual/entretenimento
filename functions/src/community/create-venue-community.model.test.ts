// functions/src/community/create-venue-community.model.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCreateVenueCommunityRequest } from './create-venue-community.model';

const VALID_REQUEST_ID = '4b7fb4a1-91e5-4dbf-9cc7-42fd4d77f779';

test('normaliza um Local e deriva IDs controlados pelo backend', () => {
  const result = normalizeCreateVenueCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: '  Espaço Áurea Centro  ',
    kind: 'event_space',
    description: '  Encontros e novidades. ',
    region: { uf: 'rj', city: ' Rio de Janeiro ', district: ' Centro ' },
    addressHint: ' Próximo à região central ',
    joinPolicy: 'open',
  });

  assert.deepEqual(result, {
    requestId: VALID_REQUEST_ID,
    venueId: `venue-${VALID_REQUEST_ID}`,
    communityId: `community-${VALID_REQUEST_ID}`,
    name: 'Espaço Áurea Centro',
    slug: 'espaco-aurea-centro',
    kind: 'event_space',
    description: 'Encontros e novidades.',
    region: { uf: 'RJ', city: 'rio de janeiro', district: 'Centro' },
    addressHint: 'Próximo à região central',
    joinPolicy: 'open',
  });
});

test('usa aprovação como política conservadora por padrão', () => {
  const result = normalizeCreateVenueCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: 'Local Teste',
    kind: 'bar',
    region: { uf: 'SP', city: 'São Paulo' },
  });

  assert.equal(result?.joinPolicy, 'approval');
  assert.equal(result?.region.district, null);
  assert.equal(result?.description, null);
  assert.equal(result?.addressHint, null);
});

test('rejeita requestId, nome, tipo e região inválidos', () => {
  assert.equal(
    normalizeCreateVenueCommunityRequest({
      requestId: 'placeholder',
      name: 'Local',
      kind: 'bar',
      region: { uf: 'RJ', city: 'Rio de Janeiro' },
    }),
    null
  );

  assert.equal(
    normalizeCreateVenueCommunityRequest({
      requestId: VALID_REQUEST_ID,
      name: 'A',
      kind: 'invalid',
      region: { uf: 'R', city: '' },
    }),
    null
  );
});

test('não aceita IDs, owner ou estados enviados pelo cliente', () => {
  const result = normalizeCreateVenueCommunityRequest({
    requestId: VALID_REQUEST_ID,
    name: 'Local Seguro',
    kind: 'club',
    region: { uf: 'RJ', city: 'Rio de Janeiro' },
    venueId: 'venue-forjado',
    communityId: 'community-forjada',
    ownerUid: 'outro-usuario',
    moderation: { state: 'active' },
  } as Record<string, unknown>);

  assert.equal(result?.venueId, `venue-${VALID_REQUEST_ID}`);
  assert.equal(result?.communityId, `community-${VALID_REQUEST_ID}`);
  assert.equal('ownerUid' in (result ?? {}), false);
  assert.equal('moderation' in (result ?? {}), false);
});
