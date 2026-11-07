import assert from 'node:assert/strict';
import test from 'node:test';
import {candidateFromPublicProfile} from '../maintenance/discovery-legacy-recovery-rehearsal.policy.mjs';
import {
  SYNTHETIC_SANITIZATION_PHASE,
  expectedSanitizedSyntheticProfile,
  planIsolatedSyntheticSanitization,
  assertSyntheticSanitizationNeverAuthorizesRealData,
} from '../maintenance/discovery-legacy-sanitization-synthetic.policy.mjs';

const ownerUid='synthetic-issue236-demo';
function input() {
  const baseline={uid:ownerUid,nickname:'Synthetic',publicDescription:'preserved',
    publicMediaCount:42,nested:{visible:true,arr:['free','basic']},
    interestedInGenders:['TEST_A','TEST_B'],interestedInOrientations:[]};
  const candidate=candidateFromPublicProfile(ownerUid,baseline);
  return {ownerUid,owner:{accountStatus:'active',publicVisibility:'visible'},
    source:structuredClone(baseline),recovery:structuredClone(candidate),
    candidate,baseline};
}

test('synthetic target has exactly the canonical two B2.1 removable field names',()=>{
  const data=input();
  const plan=planIsolatedSyntheticSanitization(data);
  assert.equal(SYNTHETIC_SANITIZATION_PHASE,'B2_9_3G_SYNTHETIC_ONLY');
  assert.deepEqual(plan.fieldNames,['interestedInGenders','interestedInOrientations']);
  assert.equal(plan.alreadySanitized,false);
  assert.equal(JSON.stringify(plan).includes('TEST_A'),false);
  assert.ok(Object.isFrozen(plan));
});

test('sanitization only removes two fields and does not mutate its original input',()=>{
  const data=input();const before=structuredClone(data.baseline);
  const after=expectedSanitizedSyntheticProfile(data.baseline);
  assert.equal(Object.hasOwn(after,'interestedInGenders'),false);
  assert.equal(Object.hasOwn(after,'interestedInOrientations'),false);
  assert.equal(after.nickname,before.nickname);
  assert.equal(after.publicMediaCount,before.publicMediaCount);
  assert.deepEqual(after.nested,before.nested);
  assert.deepEqual(data.baseline,before);
  const repeat=planIsolatedSyntheticSanitization({...data,source:after});
  assert.equal(repeat.alreadySanitized,true);
  assert.deepEqual(repeat.fieldNames,[]);
});

test('rejects malformed, missing, orphaned or tampered private recovery records',()=>{
  const data=input();
  for(const recovery of [
    null,undefined,{},
    {...data.recovery,contentSha256:'0'.repeat(64)},
    {...data.recovery,ownerUid:'synthetic-issue236-another'},
    {...data.recovery,extraUnexpectedField:true},
    {...data.recovery,legacyRaw:{...data.recovery.legacyRaw,
      interestedInGenders:['ALTERED']}},
  ]) assert.throws(()=>planIsolatedSyntheticSanitization({...data,recovery}));
});

test('declines deleted, purging, suspended and blocked owners',()=>{
  const data=input();
  const variations=[
    {accountStatus:'deleted'},{accountStatus:'pending_deletion'},
    {deletionRequestedAt:123},{purgeLeaseOwner:'active-lease'},
    {purgeLeaseUntil:100},{suspended:true},{interactionBlocked:true},
    {accountLocked:true},{loginAllowed:false},{legalHold:true},
    {billingHold:true},
  ];
  for(const patch of variations)assert.throws(()=>planIsolatedSyntheticSanitization(
    {...data,owner:{...data.owner,...patch}}));
});

test('rejects changes to any nonlegacy source field as well as cross-owner swaps',()=>{
  const data=input();
  assert.throws(()=>planIsolatedSyntheticSanitization(
    {...data,source:{...data.source,publicMediaCount:43}}),/B293G_SOURCE_CHANGED/);
  assert.throws(()=>planIsolatedSyntheticSanitization(
    {...data,ownerUid:'real-user'}),/B293G_INPUT_DENIED/);
  assert.throws(()=>planIsolatedSyntheticSanitization(
    {...data,baseline:{...data.baseline,uid:'synthetic-issue236-other'}}));
  assert.throws(()=>planIsolatedSyntheticSanitization(
    {...data,source:{...data.source,hardRules:{seek:'test'}}}));
});

test('an aggregate success cannot authorize actual sanitation',()=>{
  assert.throws(()=>assertSyntheticSanitizationNeverAuthorizesRealData(),
    /B293G_PRODUCTION_SANITIZATION_DENIED/);
  const data=input();
  assert.throws(()=>planIsolatedSyntheticSanitization(
    {...data,approved:true}),/B293G_INPUT_DENIED/);
});
