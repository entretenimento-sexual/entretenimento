import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyLegacyPhotoCleanupReadiness as classify,
  LEGACY_ORIGIN_BLOCKERS,
} from '../dev/photo-legacy-cleanup-readiness.policy.mjs';

const ownerUid = 'ownerA';
const photoId = 'photoB';
const originalPath = `users/${ownerUid}/uploads/images/source.png`;
const publishedStoragePath =
  `users/${ownerUid}/published/images/${photoId}/v1`;
const valid = {
  ownerUid, photoId, originalPath,
  original: { exists: true, generation: '11' },
  final: { exists: true, generation: '20' },
  publication: {
    ownerUid, photoId, isPublished: true,
    visibility: 'FRIENDS', moderationStatus: 'APPROVED',
    publishedStoragePath, assetVersion: 200, publishedAt: 100,
    displayDate: null,
  },
  projection: {
    ownerUid, visibility: 'FRIENDS',
    moderationStatus: 'APPROVED', assetVersion: 200,
  },
  deletionJob: false, privateDocument: { displayDate: 123 },
};

describe('auditoria de prontidão de originais legados é somente bloqueadora', () => {
  it('nunca emite um estado de limpeza autorizada', () => {
    assert.equal(classify(valid), 'legacy_consumers_or_retention_unverified');
    assert.ok(!LEGACY_ORIGIN_BLOCKERS.some((key) => /^(ready|delete|eligible)$/.test(key)));
    assert.ok(LEGACY_ORIGIN_BLOCKERS.includes(classify(valid)));
  });

  it('preserva publicação quando a origem técnica já não existe', () => {
    assert.equal(classify({
      ...valid, original: { exists: false, generation: null },
    }), 'private_original_already_missing');
  });

  it('exige ativo final e gerações observáveis', () => {
    assert.equal(classify({
      ...valid, final: { exists: false, generation: null },
    }), 'final_asset_missing_or_unpinned');
    assert.equal(classify({
      ...valid, original: { exists: true, generation: null },
    }), 'private_original_unpinned');
  });

  it('não aceita outro proprietário ou caminhos externos', () => {
    assert.equal(classify({
      ...valid, originalPath: 'users/other/uploads/images/source.png',
    }), 'invalid_identity_or_source');
    assert.equal(classify({
      ...valid,
      publication: { ...valid.publication, publishedStoragePath: originalPath },
    }), 'published_metadata_invalid');
  });

  it('recusa projeção ausente ou divergente, inclusive versão antiga', () => {
    assert.equal(classify({ ...valid, projection: null }),
      'published_projection_missing_or_mismatched');
    assert.equal(classify({
      ...valid, projection: { ...valid.projection, assetVersion: 199 },
    }), 'published_projection_missing_or_mismatched');
  });

  it('não libera evidências ou moderação sob revisão', () => {
    assert.equal(classify({
      ...valid,
      publication: { ...valid.publication, moderationStatus: 'FLAGGED' },
      projection: { ...valid.projection, moderationStatus: 'FLAGGED' },
    }), 'moderation_or_legal_review');
  });

  it('detecta origem referenciada, job, upload pendente ou data não migrada', () => {
    assert.equal(classify({
      ...valid,
      publication: { ...valid.publication, sourceStoragePath: originalPath },
    }), 'live_source_reference');
    assert.equal(classify({ ...valid, deletionJob: true }),
      'deletion_job_present');
    assert.equal(classify({
      ...valid, privateDocument: { feedPublicationPending: true },
    }), 'pending_upload_lifecycle');
    assert.equal(classify({
      ...valid,
      publication: { ...valid.publication, displayDate: undefined },
    }), 'unmigrated_display_date');
  });

  it('não trata postagem inativa como original livre para descarte', () => {
    assert.equal(classify({
      ...valid,
      publication: { ...valid.publication, isPublished: false },
    }), 'no_active_publication');
  });
});
