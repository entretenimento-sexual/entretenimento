import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const profile = read('functions/src/community/get-profile-public-communities.handler.ts');
const member = read('functions/src/community/community-member-search-index.policy.ts');
const workflow = read('.github/workflows/discovery-legacy-recovery-transaction-guard.yml');

test('community profile disclosure refuses canonical legacy fields before block check and return', () => {
  assert.match(profile, /import \{ hasLegacyPrivateDiscoveryFields \} from '\.\.\/discovery\/legacy-public-profile-preservation\.policy'/);
  const body = profile.split('export function isCurrentPublicProfileForCommunityDisclosure(')[1].split('export const getProfilePublicCommunities')[0];
  assert.match(body, /!hasLegacyPrivateDiscoveryFields\(profile\)/);
  const readPos = profile.indexOf(".collection('public_profiles')");
  const checkPos = profile.indexOf('isCurrentPublicProfileForCommunityDisclosure(', readPos);
  const blockPos = profile.indexOf('await assertNoActiveBilateralBlock(', readPos);
  assert.ok(readPos >= 0 && checkPos > readPos && blockPos > checkPos);
});

test('community search writer and callable revalidation share one fail-closed policy', () => {
  assert.match(member, /!hasLegacyPrivateDiscoveryFields\(rawProfile\)/);
  assert.match(member, /legacyPrivateFieldsPresent: hasLegacyPrivateDiscoveryFields\(rawProfile\)/);
  const writer = read('functions/src/community/sync-community-member-search-index-from-public-profile.trigger.ts');
  const reader = read('functions/src/community/search-community-members-page.handler.ts');
  assert.match(writer, /buildCommunityMemberSearchIndexProjection\(/);
  assert.match(reader, /buildCommunityMemberSearchIndexProjection\(/);
  assert.match(reader, /if \(!projection \|\| !projection\.searchPrefixes\.includes\(query\)\) continue/);
});

test('CI pins source tests, compiled tests and read-only inventory on both operating systems', () => {
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, /Guard Issue 235\/236 community reader source contracts/);
  assert.match(workflow, /Guard Issue 235\/236 compiled community public reader policies/);
  assert.match(workflow, /node scripts\/quality\/audit-public-profile-readers\.mjs --check-known/);
});
