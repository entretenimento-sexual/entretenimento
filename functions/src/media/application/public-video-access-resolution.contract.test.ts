import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const callable = readFileSync(
  resolve(__dirname, '../../../src/media/application/get-public-video-access-urls.handler.ts'),
  'utf8'
);
const core = readFileSync(
  resolve(__dirname, '../../../src/media/application/public-video-access-resolution.firestore.ts'),
  'utf8'
);

test('public video callable preserves account, bilateral and owner exposure gates', () => {
  assert.ok(callable.includes('await assertPublicMediaConsumptionAccess(viewerUid)'));
  assert.ok(callable.includes('await resolveBlockedTargetUids(viewerUid, ownerUids)'));
  assert.ok(callable.includes('await resolvePublicMediaSignedOwnerExposure('));
  assert.ok(callable.includes('resolvePublicVideoSignedAccessItem('));
  assert.ok(callable.includes('ownerExposureAllowed: profileAccess?.allowed === true'));
});

test('public video URL signer is subordinate to current publication and expiry', () => {
  assert.ok(core.includes('isCurrentPublicMediaAssetExposure({'));
  assert.ok(core.includes('publication[\'publishedStoragePath\']'));
  assert.ok(core.includes('resolvePublicMediaSignedUrlExpiresAt({'));
  assert.ok(core.includes('if (expiresAt === null)'));
  assert.ok(core.includes('shouldIssuePublicVideoPlaybackAccess(mode)'));
  assert.ok(core.includes('ports.createReadUrl(videoStoragePath, expiresAt)'));
});
