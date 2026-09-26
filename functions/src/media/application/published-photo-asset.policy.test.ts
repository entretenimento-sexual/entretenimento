import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLISHED_PHOTO_MAX_INPUT_EDGE,
  assertPublishedPhotoDecodedMetadata,
  assertPublishedPhotoOutput,
  assertPublishedPhotoSourceMetadata,
} from './published-photo-asset.policy';

test('published photo policy accepts the exact declared image allowlist', () => {
  const source = assertPublishedPhotoSourceMetadata({
    contentType: 'image/jpg',
    sizeBytes: 1024,
  });
  assert.equal(source.expectedFormat, 'jpeg');
});

test('published photo policy rejects MIME types outside the allowlist', () => {
  assert.throws(
    () => assertPublishedPhotoSourceMetadata({
      contentType: 'image/gif',
      sizeBytes: 1024,
    }),
    /formato de imagem suportado/
  );
});

test('published photo policy rejects declared and decoded format mismatch', () => {
  assert.throws(
    () => assertPublishedPhotoDecodedMetadata(
      { format: 'png', width: 1200, height: 800, pages: 1 },
      'jpeg'
    ),
    /não corresponde ao formato declarado/
  );
});

test('published photo policy rejects oversized dimensions and pixel bombs', () => {
  assert.throws(
    () => assertPublishedPhotoDecodedMetadata(
      {
        format: 'jpeg',
        width: PUBLISHED_PHOTO_MAX_INPUT_EDGE + 1,
        height: 100,
        pages: 1,
      },
      'jpeg'
    ),
    /dimensão máxima/
  );

  assert.throws(
    () => assertPublishedPhotoDecodedMetadata(
      { format: 'jpeg', width: 7000, height: 7000, pages: 1 },
      'jpeg'
    ),
    /quantidade máxima de pixels/
  );
});

test('published photo policy rejects animated images', () => {
  assert.throws(
    () => assertPublishedPhotoDecodedMetadata(
      { format: 'webp', width: 1200, height: 800, pages: 2 },
      'webp'
    ),
    /único quadro/
  );
});

test('published photo policy validates the final encoded asset', () => {
  assert.doesNotThrow(() => assertPublishedPhotoOutput({
    sizeBytes: 256_000,
    width: 2048,
    height: 1365,
  }));

  assert.throws(
    () => assertPublishedPhotoOutput({
      sizeBytes: 256_000,
      width: 5000,
      height: 1000,
    }),
    /dimensões inválidas/
  );
});
