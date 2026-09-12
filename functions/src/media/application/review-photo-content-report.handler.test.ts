import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveModeratedPhotoVisibility } from './review-photo-content-report.handler';

describe('review photo content audience', () => {
  it('preserva PUBLIC e FRIENDS sem converter a audiência', () => {
    assert.equal(resolveModeratedPhotoVisibility({
      photoVisibility: 'PUBLIC',
      publicationVisibility: 'PUBLIC',
      hasPhoto: true,
      hasPublication: true,
    }), 'PUBLIC');

    assert.equal(resolveModeratedPhotoVisibility({
      photoVisibility: 'FRIENDS',
      publicationVisibility: 'FRIENDS',
      hasPhoto: true,
      hasPublication: true,
    }), 'FRIENDS');
  });

  it('usa a audiência restante quando apenas uma representação existe', () => {
    assert.equal(resolveModeratedPhotoVisibility({
      photoVisibility: 'FRIENDS',
      hasPhoto: true,
      hasPublication: false,
    }), 'FRIENDS');

    assert.equal(resolveModeratedPhotoVisibility({
      publicationVisibility: 'PUBLIC',
      hasPhoto: false,
      hasPublication: true,
    }), 'PUBLIC');
  });

  it('falha fechado diante de audiência divergente ou não suportada', () => {
    assert.throws(() => resolveModeratedPhotoVisibility({
      photoVisibility: 'FRIENDS',
      publicationVisibility: 'PUBLIC',
      hasPhoto: true,
      hasPublication: true,
    }));

    assert.throws(() => resolveModeratedPhotoVisibility({
      photoVisibility: 'PREMIUM',
      publicationVisibility: 'PREMIUM',
      hasPhoto: true,
      hasPublication: true,
    }));
  });
});
