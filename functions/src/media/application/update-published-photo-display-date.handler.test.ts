import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canUpdatePublishedPhotoDisplayDate } from
  './update-published-photo-display-date.handler';

const ownerUid = 'owner1';
const photoId = 'photo1';
const version = 1_790_000_000_000;
const publication = {
  ownerUid, photoId, isPublished: true,
  visibility: 'FRIENDS', moderationStatus: 'APPROVED',
  publishedStoragePath: `users/${ownerUid}/published/images/${photoId}/v1`,
  publishedAt: version, assetVersion: version,
};
const projection = {
  ownerUid, visibility: 'FRIENDS', moderationStatus: 'APPROVED',
  publishedAt: version, assetVersion: version,
};

describe('data organizacional da publicação canônica', () => {
  it('permite PUBLIC ou FRIENDS sem referência ao original privado', () => {
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      ownerUid, photoId, version, publication, projection
    ), true);
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      ownerUid, photoId, version,
      { ...publication, visibility: 'PUBLIC' },
      { ...projection, visibility: 'PUBLIC' }
    ), true);
  });

  it('bloqueia terceiro, publicação removida ou audiência divergente', () => {
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      'intruder', photoId, version, publication, projection
    ), false);
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      ownerUid, photoId, version,
      { ...publication, isPublished: false }, projection
    ), false);
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      ownerUid, photoId, version,
      { ...publication, visibility: 'PUBLIC' }, projection
    ), false);
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      ownerUid, photoId, version, publication, null
    ), false);
  });

  it('não altera metadados enquanto a moderação protege a foto', () => {
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      ownerUid, photoId, version,
      { ...publication, moderationStatus: 'FLAGGED' }, projection
    ), false);
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      ownerUid, photoId, version, publication,
      { ...projection, moderationStatus: 'PENDING_REVIEW' }
    ), false);
  });

  it('recusa revisão antiga e caminho físico fora da publicação', () => {
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      ownerUid, photoId, version - 1, publication, projection
    ), false);
    assert.equal(canUpdatePublishedPhotoDisplayDate(
      ownerUid, photoId, version,
      { ...publication, publishedStoragePath: 'users/other/published/images/photo1/v1' },
      projection
    ), false);
  });
});
