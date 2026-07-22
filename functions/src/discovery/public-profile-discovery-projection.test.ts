import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicProfileDiscoveryProjectionMatches,
} from './public-profile-discovery-projection';

const CANONICAL = {
  normalizedGender: 'woman' as const,
  normalizedOrientation: 'bisexual' as const,
  interestedInGenders: ['man', 'woman'] as const,
  interestedInOrientations: ['heterosexual', 'bisexual'] as const,
  compatibilityReady: true,
};

test('ignora campos de billing quando discovery já está sincronizado', () => {
  assert.equal(
    publicProfileDiscoveryProjectionMatches(
      {
        ...CANONICAL,
        role: 'premium',
        billingProjectionVersion: 1,
        billingProjectionUpdatedAt: 123,
      },
      CANONICAL
    ),
    true
  );
});

test('detecta alteração real de compatibilidade ou ordem das preferências', () => {
  assert.equal(
    publicProfileDiscoveryProjectionMatches(
      { ...CANONICAL, normalizedGender: 'man' },
      CANONICAL
    ),
    false
  );

  assert.equal(
    publicProfileDiscoveryProjectionMatches(
      {
        ...CANONICAL,
        interestedInGenders: ['woman', 'man'],
      },
      CANONICAL
    ),
    false
  );
});

test('detecta projeção ausente para permitir backfill', () => {
  assert.equal(
    publicProfileDiscoveryProjectionMatches({}, CANONICAL),
    false
  );
});
