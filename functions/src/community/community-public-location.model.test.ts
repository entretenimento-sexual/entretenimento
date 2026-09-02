// functions/src/community/community-public-location.model.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areCommunityPublicLocationsEqual,
  normalizeCommunityPublicLocation,
} from './community-public-location.model';

test('preserva somente UF, cidade e bairro normalizados', () => {
  assert.deepEqual(
    normalizeCommunityPublicLocation({
      uf: 'sp',
      city: '  são   paulo ',
      district: '  Pinheiros  ',
      addressHint: 'Rua privada, 123',
      latitude: -23.5,
      longitude: -46.6,
    }),
    {
      uf: 'SP',
      city: 'são paulo',
      district: 'Pinheiros',
    }
  );
});

test('aceita bairro ausente sem inventar localização precisa', () => {
  assert.deepEqual(
    normalizeCommunityPublicLocation({
      uf: 'RJ',
      city: 'Rio de Janeiro',
      district: '',
    }),
    {
      uf: 'RJ',
      city: 'Rio de Janeiro',
      district: null,
    }
  );
});

test('rejeita UF inexistente e cidade ausente', () => {
  assert.equal(
    normalizeCommunityPublicLocation({ uf: 'ZZ', city: 'Cidade' }),
    null
  );
  assert.equal(
    normalizeCommunityPublicLocation({ uf: 'SP', city: '' }),
    null
  );
});

test('compara localização pública estruturalmente', () => {
  const location = { uf: 'MG', city: 'Belo Horizonte', district: 'Centro' };

  assert.equal(areCommunityPublicLocationsEqual(location, { ...location }), true);
  assert.equal(
    areCommunityPublicLocationsEqual(location, { ...location, district: null }),
    false
  );
  assert.equal(areCommunityPublicLocationsEqual(null, null), true);
});
