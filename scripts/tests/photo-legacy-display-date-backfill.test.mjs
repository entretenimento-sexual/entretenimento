import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyLegacyPublishedPhotoDate as classify } from
  '../dev/legacy-photo-display-date-backfill.policy.mjs';

const base = {
  ownerUid: 'owner', photoId: 'photo',
  privatePhoto: { displayDate: 1_690_000_000_000 },
  publication: {
    ownerUid: 'owner', photoId: 'photo', isPublished: true,
    visibility: 'FRIENDS', moderationStatus: 'APPROVED',
    publishedStoragePath: 'users/owner/published/images/photo/v2',
  },
  deletionJob: false,
};
describe('data legada só pode migrar para a publicação canônica', () => {
  it('permite apenas data legada válida e publicação ativa', () => {
    assert.equal(classify(base), 'backfill_possible');
    assert.equal(classify({ ...base, publication: {
      ...base.publication, visibility: 'PUBLIC',
    } }), 'backfill_possible');
  });
  it('preserva null explícito e datas já migradas', () => {
    for (const displayDate of [null, 0, 1_690_000_000_001]) {
      assert.equal(classify({ ...base, publication: {
        ...base.publication, displayDate,
      } }), 'already_canonical');
    }
  });
  it('não repassa datas inválidas ou ausência de documento legado', () => {
    for (const value of ['2023-01-01', NaN, Infinity, -1, 4_133_980_800_000]) {
      assert.equal(classify({ ...base, privatePhoto: {
        displayDate: value,
      } }), 'no_valid_legacy_date');
    }
    assert.equal(classify({ ...base, privatePhoto: null }), 'invalid_legacy_record');
  });
  it('não altera publicações removidas, em exclusão ou moderação', () => {
    assert.equal(classify({ ...base, publication: null }),
      'publication_missing_or_inactive');
    assert.equal(classify({ ...base, deletionJob: true }), 'deletion_in_progress');
    assert.equal(classify({ ...base, publication: {
      ...base.publication, moderationStatus: 'FLAGGED',
    } }), 'moderation_protected');
  });
  it('exige identidade e arquivo final próprios, sem tocar em uploads', () => {
    assert.equal(classify({ ...base, ownerUid: 'other' }),
      'publication_missing_or_inactive');
    assert.equal(classify({ ...base, publication: {
      ...base.publication,
      publishedStoragePath: 'users/other/published/images/photo/v2',
    } }), 'invalid_final_publication_path');
  });
});
