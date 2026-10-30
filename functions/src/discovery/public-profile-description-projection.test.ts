import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPublicDescriptionProjection,
  publicDescriptionProjectionMatches,
} from './public-profile-discovery-projection';

describe('public profile description projection', () => {
  it('não publica descrição privada por padrão ou com opt-in negado', () => {
    assert.deepEqual(
      buildPublicDescriptionProjection({ descricao: 'Texto pessoal' }),
      { publicDescription: null }
    );
    assert.deepEqual(
      buildPublicDescriptionProjection({
        descricao: 'Texto pessoal',
        publicDescriptionVisible: false,
      }),
      { publicDescription: null }
    );
  });

  it('publica somente apresentação explicitamente autorizada e sanitizada', () => {
    const published = buildPublicDescriptionProjection({
      descricao: '  Prazer em conhecer pessoas.  ',
      publicDescriptionVisible: true,
    });
    assert.deepEqual(published, {
      publicDescription: 'Prazer em conhecer pessoas.',
    });
    assert.equal(publicDescriptionProjectionMatches({}, published), false);
    assert.equal(publicDescriptionProjectionMatches(published, published), true);
  });

  it('revoga a apresentação quando a autorização é retirada', () => {
    const revoked = buildPublicDescriptionProjection({
      descricao: 'Texto anterior',
      publicDescriptionVisible: false,
    });
    assert.deepEqual(revoked, { publicDescription: null });
    assert.equal(
      publicDescriptionProjectionMatches(
        { publicDescription: 'Texto anterior' },
        revoked
      ),
      false
    );
  });
});
