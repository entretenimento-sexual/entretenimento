// functions/src/community/community-preview-public-location.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeCommunityDiscoveryProjection } from './community-preview.model';

function projection(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Casa Aurora',
    slug: 'casa-aurora',
    description: 'Espaço social oficial.',
    source: { type: 'venue', id: 'venue-1' },
    status: 'active',
    moderationState: 'active',
    visibility: 'public_preview',
    metrics: { memberCount: 10, postCount: 4, mediaCount: 3 },
    access: { join: 'approval' },
    ...overrides,
  };
}

test('expõe somente localização coarse válida de Local', () => {
  const card = sanitizeCommunityDiscoveryProjection(
    'community-1',
    projection({
      publicLocation: {
        uf: 'SP',
        city: 'são paulo',
        district: 'Pinheiros',
        addressHint: 'Rua privada, 123',
        latitude: -23.5,
      },
    })
  );

  assert.deepEqual(card?.publicLocation, {
    uf: 'SP',
    city: 'são paulo',
    district: 'Pinheiros',
  });
  assert.equal(card?.publicLocation ? 'addressHint' in card.publicLocation : true, false);
  assert.equal(card?.publicLocation ? 'latitude' in card.publicLocation : true, false);
});

test('não projeta localização pública em Comunidade comum', () => {
  const card = sanitizeCommunityDiscoveryProjection(
    'community-1',
    projection({
      source: { type: 'community', id: 'community-1' },
      publicLocation: { uf: 'RJ', city: 'Rio de Janeiro', district: 'Centro' },
    })
  );

  assert.equal(card ? 'publicLocation' in card : true, false);
});
