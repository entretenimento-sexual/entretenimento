import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveCanonicalPhotoAudienceTarget,
} from './photo-audience-access.policy';

const publicPhoto = {
  id: 'photo-uid',
  ownerUid: 'owner-uid',
  mediaType: 'PHOTO',
  assetAccess: 'SIGNED_URL',
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
};

const publication = {
  ownerUid: 'owner-uid',
  photoId: 'photo-uid',
  isPublished: true,
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
};

describe('photo audience canonical target', () => {
  it('resolve projeção e publicação equivalentes', () => {
    assert.deepEqual(
      resolveCanonicalPhotoAudienceTarget({
        ownerUid: 'owner-uid',
        photoId: 'photo-uid',
        action: 'PLAY',
        publicPhoto,
        publication,
      }),
      {
        ownerUid: 'owner-uid',
        action: 'PLAY',
        visibility: 'PUBLIC',
        isPublished: true,
        moderationStatus: 'APPROVED',
      }
    );
  });

  it('falha fechada em identidade, tipo, acesso ou visibilidade divergente', () => {
    for (const candidate of [
      { ...publicPhoto, ownerUid: 'other-owner' },
      { ...publicPhoto, mediaType: 'VIDEO' },
      { ...publicPhoto, assetAccess: 'PUBLIC_URL' },
      { ...publicPhoto, visibility: 'FRIENDS' },
    ]) {
      assert.equal(
        resolveCanonicalPhotoAudienceTarget({
          ownerUid: 'owner-uid',
          photoId: 'photo-uid',
          action: 'LIST',
          publicPhoto: candidate,
          publication,
        }),
        null
      );
    }
  });

  it('não considera publicação privada ou não aprovada como pública', () => {
    assert.deepEqual(
      resolveCanonicalPhotoAudienceTarget({
        ownerUid: 'owner-uid',
        photoId: 'photo-uid',
        action: 'LIST',
        publicPhoto: {
          ...publicPhoto,
          visibility: 'PRIVATE',
          moderationStatus: 'PRIVATE',
        },
        publication: {
          ...publication,
          isPublished: false,
          visibility: 'PRIVATE',
          moderationStatus: 'PRIVATE',
        },
      }),
      {
        ownerUid: 'owner-uid',
        action: 'LIST',
        visibility: 'PRIVATE',
        isPublished: false,
        moderationStatus: 'PRIVATE',
      }
    );
  });
});
