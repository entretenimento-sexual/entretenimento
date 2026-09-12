import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canCommentOnPublishedPhoto,
  canReadPublishedPhotoAudience,
} from './photo-audience-access.policy';

describe('photo audience access policy', () => {
  it('mantém PUBLIC disponível e restringe FRIENDS a dono ou amigo', () => {
    assert.equal(canReadPublishedPhotoAudience({
      visibility: 'PUBLIC',
      viewerIsOwner: false,
      viewerIsFriend: false,
    }), true);
    assert.equal(canReadPublishedPhotoAudience({
      visibility: 'FRIENDS',
      viewerIsOwner: false,
      viewerIsFriend: true,
    }), true);
    assert.equal(canReadPublishedPhotoAudience({
      visibility: 'FRIENDS',
      viewerIsOwner: false,
      viewerIsFriend: false,
    }), false);
    assert.equal(canReadPublishedPhotoAudience({
      visibility: 'PREMIUM',
      viewerIsOwner: true,
      viewerIsFriend: true,
    }), false);
  });

  it('aplica a política de comentários sem abrir assinantes', () => {
    assert.equal(canCommentOnPublishedPhoto({
      commentsEnabled: true,
      commentsPolicy: 'EVERYONE',
      viewerIsOwner: false,
      viewerIsFriend: false,
    }), true);
    assert.equal(canCommentOnPublishedPhoto({
      commentsEnabled: true,
      commentsPolicy: 'FRIENDS',
      viewerIsOwner: false,
      viewerIsFriend: true,
    }), true);
    assert.equal(canCommentOnPublishedPhoto({
      commentsEnabled: true,
      commentsPolicy: 'FRIENDS',
      viewerIsOwner: false,
      viewerIsFriend: false,
    }), false);
    assert.equal(canCommentOnPublishedPhoto({
      commentsEnabled: true,
      commentsPolicy: 'SUBSCRIBERS',
      viewerIsOwner: false,
      viewerIsFriend: true,
    }), false);
  });
});
