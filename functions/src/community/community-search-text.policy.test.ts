import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCommunitySearchPrefixes,
  normalizeCommunitySearchQuery,
  normalizeCommunitySearchText,
} from './community-search-text.policy';

describe('community search text policy', () => {
  it('normalizes case, accents and whitespace', () => {
    assert.equal(normalizeCommunitySearchText('  Joao   ACAO '), 'joao acao');
    assert.equal(normalizeCommunitySearchQuery('  Joao   ACAO '), 'joao acao');
  });

  it('rejects one-character queries and preserves empty input', () => {
    assert.equal(normalizeCommunitySearchQuery(''), '');
    assert.equal(normalizeCommunitySearchQuery('a'), null);
  });

  it('builds bounded prefixes across multiple fields', () => {
    const prefixes = buildCommunitySearchPrefixes(
      'Fotografia Noturna',
      'Encontro no centro'
    );

    assert.ok(prefixes.includes('fo'));
    assert.ok(prefixes.includes('fotografia'));
    assert.ok(prefixes.includes('no'));
    assert.ok(prefixes.includes('noturna'));
    assert.ok(prefixes.includes('en'));
    assert.ok(prefixes.length <= 64);
  });
});
