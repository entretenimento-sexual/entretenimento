import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareAuthorizedPhotoDocuments } from './get-authorized-photo-owner-page.handler';

describe('authorized photo owner page', () => {
  it('ordena por publicação mais recente e usa path como desempate descendente', () => {
    const documents = [
      {
        publishedAt: 100,
        path: 'public_profiles/a/public_photos/photo-a',
      },
      {
        publishedAt: 120,
        path: 'public_profiles/b/public_photos/photo-b',
      },
      {
        publishedAt: 100,
        path: 'public_profiles/c/public_photos/photo-c',
      },
    ].sort(compareAuthorizedPhotoDocuments);

    assert.deepEqual(
      documents.map((item) => item.path),
      [
        'public_profiles/b/public_photos/photo-b',
        'public_profiles/c/public_photos/photo-c',
        'public_profiles/a/public_photos/photo-a',
      ]
    );
  });
});
