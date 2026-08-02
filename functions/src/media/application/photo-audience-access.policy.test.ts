import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveCanonicalPhotoAudienceTarget,
} from './photo-audience-access.policy';

function canonicalInput() {
  return {
    ownerUid: 'owner-1',
    photoId: 'photo-1',
    publicPhoto: {
      id: 'photo-1',
      ownerUid: 'owner-1',
      mediaType: 'PHOTO',
      assetAccess: 'SIGNED_URL',
      visibility: 'FRIENDS',
      moderationStatus: 'APPROVED',
    },
    publication: {
      ownerUid: 'owner-1',
      photoId: 'photo-1',
      isPublished: true,
      visibility: 'FRIENDS',
      moderationStatus: 'APPROVED',
    },
  };
}

describe('photo-audience-access.policy', () => {
  it('resolve publicação canônica sem reduzir a visibilidade a PUBLIC', () => {
    assert.deepEqual(
      resolveCanonicalPhotoAudienceTarget(canonicalInput()),
      {
        ownerUid: 'owner-1',
        action: 'PLAY',
        visibility: 'FRIENDS',
        isPublished: true,
        moderationStatus: 'APPROVED',
      }
    );
  });

  it('fecha o acesso quando projeção e publicação divergem', () => {
    const input = canonicalInput();
    input.publication.visibility = 'PUBLIC';

    assert.equal(resolveCanonicalPhotoAudienceTarget(input), null);
  });

  it('fecha o acesso para identidade, tipo ou estratégia de ativo inválidos', () => {
    const wrongOwner = canonicalInput();
    wrongOwner.publicPhoto.ownerUid = 'other-owner';
    assert.equal(resolveCanonicalPhotoAudienceTarget(wrongOwner), null);

    const wrongType = canonicalInput();
    wrongType.publicPhoto.mediaType = 'VIDEO';
    assert.equal(resolveCanonicalPhotoAudienceTarget(wrongType), null);

    const permanentUrl = canonicalInput();
    permanentUrl.publicPhoto.assetAccess = 'PUBLIC_URL';
    assert.equal(resolveCanonicalPhotoAudienceTarget(permanentUrl), null);
  });

  it('mantém isPublished no alvo para a política de audiência negar', () => {
    const input = canonicalInput();
    input.publication.isPublished = false;

    assert.equal(
      resolveCanonicalPhotoAudienceTarget(input)?.isPublished,
      false
    );
  });
});
