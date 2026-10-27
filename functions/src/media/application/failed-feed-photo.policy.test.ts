import assert from 'node:assert/strict';
import test from 'node:test';
import { FAILED_FEED_PHOTO_TTL_MS, isExpiredFeedPhotoPending, isFeedPhotoCleanupStaged, isBenignFeedPhotoDeletionRace } from './failed-feed-photo.policy';

test('somente upload do feed com prazo expirado pode ser reconciliado', () => {
  const now = 10_000_000;
  assert.equal(FAILED_FEED_PHOTO_TTL_MS, 7_200_000);
  assert.equal(isExpiredFeedPhotoPending({feedPublicationPending:true,feedPublicationExpiresAtMs:now-1},now),true);
  assert.equal(isExpiredFeedPhotoPending({feedPublicationPending:true,feedPublicationExpiresAtMs:now+1},now),false);
  assert.equal(isExpiredFeedPhotoPending({feedPublicationPending:false,feedPublicationExpiresAtMs:now-1},now),false);
  assert.equal(isExpiredFeedPhotoPending({feedPublicationPending:true,feedPublicationExpiresAtMs:'bad'},now),false);
  assert.equal(isExpiredFeedPhotoPending({},now),false);
});

test('impede republicação após stage do cleanup, mas não bloqueia fotos sem tombstone', () => {
  assert.equal(isFeedPhotoCleanupStaged({}), false);
  assert.equal(isFeedPhotoCleanupStaged({feedPublicationCleanupStagedAtMs: 0}), false);
  assert.equal(isFeedPhotoCleanupStaged({feedPublicationCleanupStagedAtMs: 'bad'}), false);
  assert.equal(isFeedPhotoCleanupStaged({feedPublicationCleanupStagedAtMs: 1793076000000}), true);
});

test('classifica disputa transacional esperada sem esconder outras falhas', () => {
  assert.equal(isBenignFeedPhotoDeletionRace({code:'failed-precondition',message:'Upload não elegível para descarte.'}), true);
  assert.equal(isBenignFeedPhotoDeletionRace({code:'functions/failed-precondition',message:'Upload não elegível para descarte.'}), true);
  assert.equal(isBenignFeedPhotoDeletionRace({code:'internal',message:'Upload não elegível para descarte.'}), false);
  assert.equal(isBenignFeedPhotoDeletionRace({code:'failed-precondition',message:'Foto protegida pela moderação.'}), false);
  assert.equal(isBenignFeedPhotoDeletionRace(new Error('Storage indisponível')), false);
  assert.equal(isBenignFeedPhotoDeletionRace(null), false);
});
