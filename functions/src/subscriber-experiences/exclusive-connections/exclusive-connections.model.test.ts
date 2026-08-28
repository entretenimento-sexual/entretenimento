import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeExclusiveConnectionsPageRequest,
  sanitizeExclusiveConnectionCandidate,
} from './exclusive-connections.model';

const NOW = 1_800_000_000_000;

function createCandidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateUid: 'candidate-1',
    nickname: 'Pessoa Teste',
    photoURL: 'https://example.com/photo.jpg',
    region: { uf: 'RJ', city: 'Niterói' },
    compatibilityScore: 87.6,
    intentLabel: 'Disponível hoje',
    reasonTags: ['Mesma região', 'Interesses próximos', 'Mesma região'],
    status: 'active',
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

test('normaliza paginação com limites seguros', () => {
  assert.deepEqual(
    normalizeExclusiveConnectionsPageRequest({ limit: 999, cursor: 'candidate_1' }),
    { limit: 24, cursor: 'candidate_1' }
  );

  assert.deepEqual(
    normalizeExclusiveConnectionsPageRequest({ limit: 'x', cursor: '../escape' }),
    { limit: 12, cursor: null }
  );
});

test('sanitiza somente campos públicos necessários', () => {
  const card = sanitizeExclusiveConnectionCandidate(
    'candidate-1',
    createCandidate(),
    NOW
  );

  assert.deepEqual(card, {
    candidateUid: 'candidate-1',
    nickname: 'Pessoa Teste',
    photoURL: 'https://example.com/photo.jpg',
    region: { uf: 'RJ', city: 'Niterói' },
    compatibilityScore: 88,
    intentLabel: 'Disponível hoje',
    reasonTags: ['Mesma região', 'Interesses próximos'],
  });
});

test('remove URL insegura sem descartar o card válido', () => {
  const card = sanitizeExclusiveConnectionCandidate(
    'candidate-1',
    createCandidate({ photoURL: 'http://example.com/photo.jpg' }),
    NOW
  );

  assert.equal(card?.photoURL, null);
});

test('descarta documento expirado, inativo ou associado a outro UID', () => {
  assert.equal(
    sanitizeExclusiveConnectionCandidate(
      'candidate-1',
      createCandidate({ expiresAt: NOW }),
      NOW
    ),
    null
  );
  assert.equal(
    sanitizeExclusiveConnectionCandidate(
      'candidate-1',
      createCandidate({ status: 'hidden' }),
      NOW
    ),
    null
  );
  assert.equal(
    sanitizeExclusiveConnectionCandidate(
      'candidate-1',
      createCandidate({ candidateUid: 'candidate-2' }),
      NOW
    ),
    null
  );
});

test('descarta score, região ou intenção inválidos', () => {
  assert.equal(
    sanitizeExclusiveConnectionCandidate(
      'candidate-1',
      createCandidate({ compatibilityScore: 101 }),
      NOW
    ),
    null
  );
  assert.equal(
    sanitizeExclusiveConnectionCandidate(
      'candidate-1',
      createCandidate({ region: { uf: 'R', city: '' } }),
      NOW
    ),
    null
  );
  assert.equal(
    sanitizeExclusiveConnectionCandidate(
      'candidate-1',
      createCandidate({ intentLabel: '' }),
      NOW
    ),
    null
  );
});
