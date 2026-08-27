import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublishedPhotoReference,
  buildPublishedVideoReference,
  normalizePublishedMediaReference,
} from './published-media-reference.model';

test('constrói referência canônica de foto publicada', () => {
  const reference = buildPublishedPhotoReference({
    ownerUid: 'user-1',
    mediaId: 'photo-1',
    storagePath:
      'users/user-1/published/images/photo-1/1800000000000-version',
    alt: '  Foto   no mural  ',
  });

  assert.deepEqual(reference, {
    mediaType: 'PHOTO',
    mediaId: 'photo-1',
    ownerUid: 'user-1',
    assetAccess: 'SIGNED_URL',
    storagePath:
      'users/user-1/published/images/photo-1/1800000000000-version',
    alt: 'Foto no mural',
  });
});

test('rejeita foto cujo path não pertence ao owner/mediaId', () => {
  assert.throws(() =>
    buildPublishedPhotoReference({
      ownerUid: 'user-1',
      mediaId: 'photo-1',
      storagePath:
        'users/user-2/published/images/photo-1/1800000000000-version',
    })
  );

  assert.throws(() =>
    buildPublishedPhotoReference({
      ownerUid: 'user-1',
      mediaId: 'photo-1',
      storagePath:
        'users/user-1/published/images/photo-2/1800000000000-version',
    })
  );
});

test('constrói referência canônica de vídeo publicado e poster opcional', () => {
  const reference = buildPublishedVideoReference({
    ownerUid: 'user-1',
    mediaId: 'video-1',
    storagePath:
      'users/user-1/published/videos/video-1/assets/1800000000000-version',
    posterStoragePath:
      'users/user-1/published/videos/video-1/posters/1800000000000-version',
    mimeType: 'video/mp4',
    durationMs: 12_345,
    alt: 'Vídeo na comunidade',
  });

  assert.equal(reference.mediaType, 'VIDEO');
  assert.equal(reference.assetAccess, 'SIGNED_URL');
  assert.equal(reference.mimeType, 'video/mp4');
  assert.equal(reference.durationMs, 12_345);
  assert.ok(reference.posterStoragePath);
});

test('normalização falha fechado para referência manipulada', () => {
  assert.equal(
    normalizePublishedMediaReference({
      mediaType: 'PHOTO',
      mediaId: 'photo-1',
      ownerUid: 'user-1',
      assetAccess: 'PUBLIC_URL',
      storagePath:
        'users/user-1/published/images/photo-1/1800000000000-version',
    }),
    null
  );

  assert.equal(
    normalizePublishedMediaReference({
      mediaType: 'VIDEO',
      mediaId: 'video-1',
      ownerUid: 'user-1',
      assetAccess: 'SIGNED_URL',
      storagePath:
        'users/user-1/published/videos/video-1/assets/1800000000000-version',
      mimeType: 'video/avi',
      durationMs: 10_000,
    }),
    null
  );
});
