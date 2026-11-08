import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url),'utf8').replace(/\r\n/g,'\n');
test('media public owner exposure fail closes for legacy private keys', () => {
  const media=read('functions/src/media/application/public-media-exposure.policy.ts');
  const p=media.indexOf('export function evaluatePublicMediaOwnerExposure(');
  assert.ok(p>=0);
  const segment=media.slice(p,media.indexOf('export function evaluatePublicMediaSignedOwnerExposure(',p));
  assert.match(segment,/hasLegacyPrivateDiscoveryFields\(input\.publicProfile\)/);
  assert.match(segment,/denialReason: 'OWNER_NOT_PUBLIC'/);
  assert.doesNotMatch(segment,/\['interestedInGenders'\]/);
});
test('community roster and cursor fail closed for contaminated profiles',()=>{
  const s=read('functions/src/community/get-community-member-roster-page.handler.ts');
  assert.match(s,/return !!profile && !hasLegacyPrivateDiscoveryFields\(profile\)/);
  assert.match(s,/if \(!isCurrentCommunityMemberPublicProfile\([\s\S]*?profileSnapshot\.docs\[0\]\.data\(\)/);
});
test('official community endpoints deny contaminated profile associations',()=>{
  for(const p of ['get-profile-official-communities.handler.ts','get-official-communities-for-target.handler.ts']) {
    const s=read('functions/src/community/'+p);
    const check=s.indexOf('if (hasLegacyPrivateDiscoveryFields(targetProfileSnapshot.data()))');
    const block=s.indexOf('await assertNoActiveBilateralBlock(');
    assert.ok(check>=0 && block>check,p);
    assert.match(s.slice(check,block),/return emptyResponse\(\)/);
  }
});
test('source tests and compiled tests run on both OS in CI',()=>{
  const s=read('.github/workflows/discovery-legacy-recovery-transaction-guard.yml');
  assert.match(s,/os: \[ubuntu-latest, windows-latest\]/);
  assert.match(s,/issue235236-public-reader-quarantine-stage2\.contract\.test\.mjs/);
  for(const f of ['public-media-exposure.policy.test.js','get-community-member-roster-page.handler.test.js','get-profile-official-communities.contract.test.js','get-official-communities-for-target.contract.test.js'])assert.ok(s.includes('node --test lib/'+(f.startsWith('public')?'media/application/':'community/')+f),f);
});
