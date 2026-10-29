import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyLegacyPhotoOrigin,
  isPublicationPresentAndProtected,
} from './legacy-photo-origin-preservation.policy';

const ownerUid = 'authorA';
const photoId = 'photoA';
const source = `users/${ownerUid}/uploads/images/photo-original.png`;
const published = `users/${ownerUid}/published/images/${photoId}/v1`;
const current = {
  ownerUid, photoId,
  isPublished: true, visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  sourceStoragePath: source, publishedStoragePath: published,
};
function inspect(overrides: {
  publication?: Record<string, unknown> | null;
  sourceExists?: boolean;
  source?: string;
} = {}) {
  return classifyLegacyPhotoOrigin({
    ownerUid, photoId, privateSourcePath: overrides.source ?? source,
    publication: overrides.publication === undefined
      ? current : overrides.publication,
    sourceExists: overrides.sourceExists ?? true,
  });
}

describe('legacy published photo origin preservation', () => {
  it('identifica origens técnicas redundantes sem autorizar exclusão', () => {
    assert.equal(inspect(), 'published_final_exists');
    assert.equal(inspect({ sourceExists: false }), 'published_source_missing');
  });
  it('nunca trata quarentena como autorização para eliminar a publicação', () => {
    const quarantined = {
      ...current, moderationStatus: 'FLAGGED',
    };
    assert.equal(inspect({ publication: quarantined, sourceExists: false }),
      'published_source_missing');
    assert.equal(isPublicationPresentAndProtected(quarantined), true);
  });
  it('protege publicações com metadados incompletos para revisão manual', () => {
    assert.equal(inspect({ publication: {
      ...current, publishedStoragePath: null,
    } }), 'published_needs_review');
    assert.equal(inspect({ publication: {
      ...current, visibility: 'ONLY_ME',
    } }), 'published_needs_review');
    assert.equal(inspect({ publication: {
      ...current, ownerUid: 'different',
    } }), 'published_needs_review');
  });
  it('nunca confunde ausência de original com despublicação', () => {
    assert.equal(inspect({ publication: null, sourceExists: false }),
      'unpublished');
    assert.equal(inspect({ publication: { ...current, isPublished: false },
      sourceExists: false }), 'unpublished');
    assert.equal(isPublicationPresentAndProtected(null), false);
    assert.equal(isPublicationPresentAndProtected({
      ...current, isPublished: false,
    }), false);
  });
  it('não confunde mídia final de outro proprietário ou id', () => {
    assert.equal(inspect({ publication: {
      ...current,
      publishedStoragePath: `users/another/published/images/${photoId}/v1`,
    }}), 'published_needs_review');
    assert.equal(inspect({ publication: {
      ...current,
      publishedStoragePath: `users/${ownerUid}/published/images/another/v1`,
    }}), 'published_needs_review');
  });
});
