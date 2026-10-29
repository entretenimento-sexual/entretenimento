import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canReplacePublishedPhoto } from './replace-published-photo.handler';

const owner = 'owner-1';
const photo = 'photo-1';
const revision = 123456789;
const publishedPath = `users/${owner}/published/images/${photo}/asset-1`;
const publication = {
  ownerUid: owner,
  photoId: photo,
  isPublished: true,
  visibility: 'FRIENDS',
  moderationStatus: 'APPROVED',
  publishedStoragePath: publishedPath,
};
const projection = {
  ownerUid: owner, visibility: 'FRIENDS',
  moderationStatus: 'APPROVED', assetVersion: revision,
};

describe('canReplacePublishedPhoto', () => {
  it('aceita FRIENDS e PUBLIC ativos mesmo sem documento privado original', () => {
    assert.equal(canReplacePublishedPhoto(owner, photo, revision,
      publication, projection), true);
    assert.equal(canReplacePublishedPhoto(owner, photo, revision,
      { ...publication, visibility: 'PUBLIC' },
      { ...projection, visibility: 'PUBLIC' }), true);
  });
  it('não troca uma mídia cujo proprietário ou token de revisão não confere', () => {
    assert.equal(canReplacePublishedPhoto('other', photo, revision,
      publication, projection), false);
    assert.equal(canReplacePublishedPhoto(owner, 'another', revision,
      publication, projection), false);
    assert.equal(canReplacePublishedPhoto(owner, photo, revision + 1,
      publication, projection), false);
    assert.equal(canReplacePublishedPhoto(owner, photo, revision,
      { ...publication, publishedStoragePath: publishedPath },
      projection, `users/${owner}/published/images/${photo}/newer`), false);
  });
  it('fecha acesso para despublicação, pendência, bloqueio e projeção obsoleta', () => {
    assert.equal(canReplacePublishedPhoto(owner, photo, revision,
      null, projection), false);
    assert.equal(canReplacePublishedPhoto(owner, photo, revision,
      publication, null), false);
    for (const override of [
      { isPublished: false },
      { moderationStatus: 'FLAGGED' },
      { moderationStatus: 'PENDING_REVIEW' },
      { visibility: 'ONLY_ME' },
      { publishedStoragePath: `users/other/published/images/${photo}/asset-1` },
    ]) {
      assert.equal(canReplacePublishedPhoto(owner, photo, revision,
        { ...publication, ...override }, projection), false);
    }
    assert.equal(canReplacePublishedPhoto(owner, photo, revision,
      publication, { ...projection, moderationStatus: 'REJECTED' }), false);
  });
  it('permite legado sem assetVersion usando publishedAt como revisão', () => {
    assert.equal(canReplacePublishedPhoto(owner, photo, revision,
      publication, { ...projection, assetVersion: undefined, publishedAt: revision }),
    true);
  });
});
