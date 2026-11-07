import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  reconcileOriginalB293cSyntheticDocuments as reconcile,
  authorizeOriginalSchemaRepair,
} from '../maintenance/discovery-legacy-original-schema-reconciliation.policy.mjs';
import {
  appendSyntheticReviewAuditEvent, REVIEW_AUDIT_KINDS,
} from '../maintenance/discovery-legacy-approval-audit-integrity.policy.mjs';

const t = 1_800_000_000_000;
const approvalId = s => `synthetic-b293c-${s}-operation`;
const auditId = s => `synthetic-b293c-${s}-audit`;
function a(s='happy', patch={}) {
  const row = {
    schemaVersion:1, operationId:approvalId(s),
    purpose:'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
    projectId:'entretenimento-sexual',
    targetCollection:'legacy_discovery_preference_recovery',
    candidateCount:2,legacyEntryCount:8,requestedByUid:'synthetic_operator',
    requestedAtMs:t-120_000,approvedByUid:'synthetic_reviewer',
    approvedAtMs:t-60_000,expiresAtMs:t+840_000,revokedAtMs:null,
    consumedAtMs:t,expiredAtMs:null,status:'CONSUMED_FOR_REVIEW_ONLY',revision:2,
    ...patch,
  };
  return {id:approvalId(s), data:row};
}
function b(s='happy', patch={}, atMs=t) {
  const events = appendSyntheticReviewAuditEvent([],{
    kind:REVIEW_AUDIT_KINDS.CONSUMED_SYNTHETIC,atMs,
  });
  return {id:auditId(s),data:{schemaVersion:1,entries:events,...patch}};
}
function run(approvals=[a()],audits=[b()]) {
  return reconcile({approvals,audits,nowMs:t+1_000});
}

test('uses exact B2.9.3c fields and preserves a structurally coherent synthetic pair',()=>{
  const x=run();
  assert.equal(x.originalApprovalsInspected,1);
  assert.equal(x.originalAuditsInspected,1);
  assert.equal(x.matchedSyntheticPairs,1);
  assert.equal(x.totalIssues,0);
  assert.equal(x.shapeReconciled,true);
  assert.equal(x.cryptographicOperationBindingVerified,false);
  assert.equal(x.sourceIsTrusted,false);
  assert.equal(x.decision,'BLOCKED');
});
test('missing audit is detectable on original approval document',()=>{
  const x=run([a()],[]);
  assert.equal(x.missingAudit,1);
  assert.equal(x.shapeReconciled,false);
});
test('audit with no original approval is orphaned',()=>{
  assert.equal(run([],[b()]).orphanAudit,1);
});
test('audit for unconsumed approval is not valid consumption evidence',()=>{
  const x=run([a('x',{status:'APPROVED_FOR_REVIEW_ONLY',revision:1,consumedAtMs:null})],[b('x')]);
  assert.equal(x.auditWithoutConsumption,1);
});
test('stale revisions cannot produce a coherent pair',()=>{
  assert.equal(run([a('x',{revision:1})],[b('x')]).invalidRevision,1);
});
test('original schema extra fields counted and never accepted',()=>{
  const x=run([a('x',{legacyRaw:['private-sentinel']})],[b('x')]);
  assert.equal(x.malformedApprovals,1);
  assert.equal(x.matchedSyntheticPairs,0);
  assert.equal(JSON.stringify(x).includes('private-sentinel'),false);
});
test('mismatched original operationId is counted as malformed',()=>{
  const x=run([a('x',{operationId:approvalId('other')})],[b('x')]);
  assert.equal(x.malformedApprovals,1);
  assert.equal(x.matchedSyntheticPairs,0);
});
test('same principal is not a valid two-party review',()=>{
  const x=run([a('x',{approvedByUid:'synthetic_operator'})],[b('x')]);
  assert.equal(x.malformedApprovals,1);
});
test('invalid synthetically named principal cannot be accepted',()=>{
  const x=run([a('x',{approvedByUid:'not a uid'})],[b('x')]);
  assert.equal(x.malformedApprovals,1);
});
test('audit with extra fields is counted as malformed',()=>{
  const x=run([a('x')],[b('x',{uid:'not-for-audit'})]);
  assert.equal(x.malformedAudits,1);
});
test('bad audit hash rejected without exposing the hash',()=>{
  const row=b('x');
  row.data.entries=[{...row.data.entries[0],entryHash:'f'.repeat(64)}];
  const x=run([a('x')],[row]);
  assert.equal(x.invalidAudit,1);
  assert.equal(JSON.stringify(x).includes('f'.repeat(64)),false);
});
test('cross-operation swap with different timestamps is detected',()=>{
  const x=run([a('one'),a('two',{consumedAtMs:t+10})],
    [b('one',{},t+10),b('two',{},t)]);
  assert.equal(x.timestampMismatch,2);
  assert.equal(x.shapeReconciled,false);
});
test('same-timestamp swap cannot be authenticated and is explicitly BLOCKED',()=>{
  const x=run([a('one'),a('two')],[b('one'),b('two')]);
  assert.equal(x.matchedSyntheticPairs,2);
  assert.equal(x.cryptographicOperationBindingVerified,false);
  assert.equal(x.decision,'BLOCKED');
  assert.equal(x.persistentWritesAllowed,false);
});
test('duplicate synthetic document IDs cannot be silently matched',()=>{
  const x=run([a('x'),a('x')],[b('x')]);
  assert.equal(x.duplicateDocumentIds,1);
  assert.equal(x.shapeReconciled,false);
});
test('invalid or unexpected document IDs always deny the entire input',()=>{
  const invalid=[{id:'real-uid',data:a().data}];
  assert.throws(()=>run(invalid,[b()]),/B293F_INPUT_DENIED/);
});
test('extra top-level keys and malformed rows always deny',()=>{
  assert.throws(()=>reconcile({approvals:[],audits:[],nowMs:t,secret:'x'}),/B293F_INPUT_DENIED/);
  assert.throws(()=>run([{id:approvalId('x'),data:a('x').data,secret:'x'}],[]),/B293F_INPUT_DENIED/);
});
test('bounded input cannot hide partial or oversized data',()=>{
  assert.throws(()=>run(Array.from({length:65},(_,i)=>a(`a-${i}`)),[]),/B293F_INPUT_DENIED/);
  assert.throws(()=>reconcile({approvals:[],audits:[],nowMs:-1}),/B293F_INPUT_DENIED/);
});
test('every output remains aggregate-only with explicit missing trust',()=>{
  const x=run([a('happy')],[b('happy')]);
  const output=JSON.stringify(x);
  for(const word of ['synthetic-b293c-happy','synthetic_operator','synthetic_reviewer',
    'operationId','requestedByUid','approvedByUid','previousHash','entryHash','syntheticKey']){
    assert.equal(output.includes(word),false,word);
  }
  for(const field of ['automatedRepairAllowed','privateRecoveryRead','privateRecoveryWritten',
    'publicVisibilityAllowed','persistentWritesAllowed','cryptographicOperationBindingVerified',
    'externalAnchorVerified']) assert.equal(x[field],false,field);
});
test('untrusted result never provides repair authority',()=>{
  assert.throws(()=>authorizeOriginalSchemaRepair(),/B293F_REPAIR_NOT_AUTHORIZED/);
});
test('policy has no IO, Firestore SDK, network, CLI or production writer',()=>{
  const source=readFileSync(new URL('../maintenance/discovery-legacy-original-schema-reconciliation.policy.mjs',import.meta.url),'utf8');
  for(const marker of ['firebase-admin','firebase/firestore','fetch(','axios',
    'getFirestore(','runTransaction(','writeFile','onCall(','onRequest(',
    'onSchedule(','process.env','execSync','spawnSync']){
    assert.equal(source.includes(marker),false,marker);
  }
});
