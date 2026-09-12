import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canReadPublishedPhotoAudience } from './photo-audience-access.policy';

describe('public photo access audience', () => {
  it('mantém PUBLIC disponível sem exigir amizade', () => {
    assert.equal(
      canReadPublishedPhotoAudience({
        visibility: 'PUBLIC',
        viewerIsOwner: false,
        viewerIsFriend: false,
      }),
      true
    );
  });

  it('libera FRIENDS somente para o dono ou amizade canônica', () => {
    assert.equal(
      canReadPublishedPhotoAudience({
        visibility: 'FRIENDS',
        viewerIsOwner: false,
        viewerIsFriend: true,
      }),
      true
    );
    assert.equal(
      canReadPublishedPhotoAudience({
        visibility: 'FRIENDS',
        viewerIsOwner: true,
        viewerIsFriend: false,
      }),
      true
    );
    assert.equal(
      canReadPublishedPhotoAudience({
        visibility: 'FRIENDS',
        viewerIsOwner: false,
        viewerIsFriend: false,
      }),
      false
    );
  });

  it('não abre audiências de assinatura neste contrato', () => {
    for (const visibility of ['SUBSCRIBERS', 'PREMIUM', 'PRIVATE']) {
      assert.equal(
        canReadPublishedPhotoAudience({
          visibility,
          viewerIsOwner: false,
          viewerIsFriend: true,
        }),
        false
      );
    }
  });
});
