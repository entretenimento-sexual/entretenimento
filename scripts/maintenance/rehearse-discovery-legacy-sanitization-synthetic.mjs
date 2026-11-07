#!/usr/bin/env node
// Issue #236 / B2.9.3g. Demo Auth + Firestore Emulator ONLY. No imported
// snapshots, live credentials, migration, deployed callable, or real-data writer.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  candidateFromPublicProfile,
  assessExistingRecovery,
  RECOVERABLE_FIELDS,
  TARGET_COLLECTION,
} from './discovery-legacy-recovery-rehearsal.policy.mjs';
import {
  expectedSanitizedSyntheticProfile,
  planIsolatedSyntheticSanitization,
  SYNTHETIC_SANITIZATION_PHASE,
} from './discovery-legacy-sanitization-synthetic.policy.mjs';

const ROOT = fileURLToPath(new URL('../../',import.meta.url));
const PROJECT = 'demo-entretenimento-legacy-governance';
const PORTS = [28080,29099,29150,29400,29450];
const BANNED = [
  'GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_CLOUD_PROJECT','GCP_PROJECT',
  'CLOUDSDK_CORE_PROJECT','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'GOOGLE_CLOUD_QUOTA_PROJECT','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN',
  'GOOGLE_CLOUD_ACCESS_TOKEN','FIREBASE_DATABASE_EMULATOR_HOST',
  'FIREBASE_STORAGE_EMULATOR_HOST',
];
const abs = f => path.join(ROOT,f);
const owners = ['synthetic-issue236-one','synthetic-issue236-two'];

function denyRemote() {
  for(const k of BANNED) assert.equal(Object.hasOwn(process.env,k),false,
    'B293G_REMOTE_CREDENTIAL_DENIED');
}
function verifyFiles() {
  assert.equal(realpathSync(process.cwd()).toLowerCase(),
    realpathSync(ROOT).toLowerCase(),'B293G_ROOT_DENIED');
  const conf = JSON.parse(readFileSync(abs('firebase.legacy-governance-e2e.json'),'utf8'));
  assert.equal(conf.emulators.singleProjectMode,true);
  assert.deepEqual(conf.emulators.firestore,{host:'127.0.0.1',port:28080,websocketPort:29150});
  assert.deepEqual(conf.emulators.auth,{host:'127.0.0.1',port:29099});
  assert.equal(conf.emulators.ui.enabled,false);
  const rules = readFileSync(abs('firestore.rules'),'utf8');
  assert.ok(rules.includes('match /legacy_discovery_preference_recovery/{ownerUid}'));
  assert.ok(rules.includes('allow read, write: if false;'));
  assert.ok(statSync(abs('functions/node_modules/firebase-admin')).isDirectory());
  assert.ok(statSync(abs('functions/lib/discovery/legacy-public-profile-preservation.policy.js')).isFile());
}
function portFree(port) {
  return new Promise(resolve => {
    const server=net.createServer();
    server.once('error',()=>resolve(false));
    server.listen({host:'127.0.0.1',port,exclusive:true},
      ()=>server.close(()=>resolve(true)));
  });
}
async function preflight() {
  denyRemote();
  for(const k of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT','FUNCTIONS_EMULATOR','FIREBASE_CONFIG','FIREBASE_PROJECT_ID']) {
    assert.equal(Object.hasOwn(process.env,k),false,'B293G_INHERITED_ENV_DENIED');
  }
  verifyFiles();
  for(const port of PORTS) assert.ok(await portFree(port),'B293G_PORT_BUSY');
  console.log('B2.9.3g PREFLIGHT PASS - no emulator started');
}
function isolated() {
  denyRemote();
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:28080');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:29099');
  assert.equal(process.env.GCLOUD_PROJECT,PROJECT);
  assert.equal(process.env.FUNCTIONS_EMULATOR,'true');
  if (process.env.FIREBASE_PROJECT_ID) assert.equal(process.env.FIREBASE_PROJECT_ID,PROJECT);
  if (process.env.FIREBASE_CONFIG) {
    assert.equal(JSON.parse(process.env.FIREBASE_CONFIG).projectId,PROJECT);
  }
  verifyFiles();
}
function fixtures() {
  return [
    {uid:owners[0],nickname:'Synthetic person A',role:'free',
      publicDescription:'Synthetic profile, no real users',photosCount:3,
      flags:{selected:true},updatedAt:12345,
      interestedInGenders:['TEST_A','TEST_B','TEST_C'],
      interestedInOrientations:[]},
    {uid:owners[1],nickname:'Synthetic person B',role:'basic',
      publicDescription:'Synthetic account for exercise only',photosCount:4,
      flags:{selected:false},updatedAt:54321,
      interestedInGenders:['TEST_D','TEST_E'],
      interestedInOrientations:['TEST_F','TEST_G','TEST_H']},
  ];
}
function safeOwner() {
  return {accountStatus:'active',publicVisibility:'visible',
    emailVerified:true,profileCompleted:true,role:'free'};
}
function snapshotPairs(db) {
  return owners.map(uid=>({
    uid,owner:db.doc(`users/${uid}`),
    source:db.doc(`public_profiles/${uid}`),
    recovery:db.doc(`${TARGET_COLLECTION}/${uid}`),
  }));
}

async function exercise() {
  isolated(); // Verify BEFORE loading Admin SDK.
  const requireFn=createRequire(abs('functions/package.json'));
  const {initializeApp,deleteApp}=requireFn('firebase-admin/app');
  const {getFirestore,FieldValue}=requireFn('firebase-admin/firestore');
  const {getAuth}=requireFn('firebase-admin/auth');
  const {hasLegacyPrivateDiscoveryFields,mustHoldLegacyPublicProfileMutation}=
    requireFn('./lib/discovery/legacy-public-profile-preservation.policy.js');
  const app=initializeApp({projectId:PROJECT},'b293g-synthetic-disposable');
  const db=getFirestore(app);const auth=getAuth(app);
  try {
    assert.equal((await db.listCollections()).length,0,'B293G_DATABASE_NOT_EMPTY');
    assert.equal((await auth.listUsers(1)).users.length,0,'B293G_AUTH_NOT_EMPTY');
    const baseline=fixtures();
    for(const uid of [...owners,'synthetic-issue236-clean']) {
      await auth.createUser({uid,email:`${uid}@example.test`,emailVerified:true});
    }
    const refs=snapshotPairs(db);
    const cleanRef=db.doc('public_profiles/synthetic-issue236-clean');
    const cleanUser=db.doc('users/synthetic-issue236-clean');
    const cleanOriginal={uid:'synthetic-issue236-clean',nickname:'Clean synthetic control',
      photosCount:7,publicDescription:'Control unchanged'};
    const writer=db.batch();
    for(let i=0;i<refs.length;i++) {
      writer.set(refs[i].owner,safeOwner());
      writer.set(refs[i].source,baseline[i]);
    }
    writer.set(cleanUser,safeOwner());
    writer.set(cleanRef,cleanOriginal);
    await writer.commit();
    const candidates=owners.map((uid,i)=>candidateFromPublicProfile(uid,baseline[i]));
    assert.ok(candidates.every(Boolean));
    assert.equal(candidates.reduce((n,c)=>n+(c.legacyRaw.interestedInGenders?.length??0),0),5);
    assert.equal(candidates.reduce((n,c)=>n+(c.legacyRaw.interestedInOrientations?.length??0),0),3);
    for(let i=0;i<refs.length;i++) {
      assert.equal(hasLegacyPrivateDiscoveryFields(baseline[i]),true);
      assert.equal(mustHoldLegacyPublicProfileMutation(safeOwner(),baseline[i]),true);
    }
    assert.equal(hasLegacyPrivateDiscoveryFields(cleanOriginal),false);

    async function stage() {
      return db.runTransaction(async tx=>{
        const snapshots=[];
        for(const r of refs) snapshots.push({
          owner:await tx.get(r.owner),source:await tx.get(r.source),
          recovery:await tx.get(r.recovery),
        });
        const dispositions=snapshots.map((s,i)=>{
          assert.deepEqual(s.owner.data(),safeOwner(),'B293G_OWNER_CHANGED');
          assert.deepEqual(s.source.data(),baseline[i],'B293G_SOURCE_CHANGED');
          return assessExistingRecovery(candidates[i],
            s.recovery.exists?s.recovery.data():null);
        });
        let created=0;
        for(let i=0;i<refs.length;i++) if(dispositions[i]==='WOULD_CREATE') {
          tx.create(refs[i].recovery,structuredClone(candidates[i]));created++;
        }
        return created;
      });
    }
    assert.equal(await stage(),2,'B293G_INITIAL_STAGING');
    assert.equal(await stage(),0,'B293G_STAGING_NOT_IDEMPOTENT');

    async function sanitize() {
      return db.runTransaction(async tx=>{
        const snapshots=[];
        for(const r of refs) snapshots.push({
          owner:await tx.get(r.owner),source:await tx.get(r.source),
          recovery:await tx.get(r.recovery),
        });
        let changed=0;
        const plans=snapshots.map((s,i)=>{
          if(!s.owner.exists||!s.source.exists||!s.recovery.exists)
            throw new Error('B293G_REQUIRED_DOC_MISSING');
          return planIsolatedSyntheticSanitization({
            ownerUid:owners[i],owner:s.owner.data(),source:s.source.data(),
            recovery:s.recovery.data(),candidate:candidates[i],baseline:baseline[i],
          });
        });
        for(let i=0;i<refs.length;i++) {
          if(plans[i].alreadySanitized)continue;
          const patch=Object.fromEntries(plans[i].fieldNames.map(k=>[k,FieldValue.delete()]));
          assert.ok(Object.keys(patch).length>0);
          tx.update(refs[i].source,patch);changed++;
        }
        return changed;
      });
    }

    // Fail closed on a changed/private quarantine copy.
    await refs[0].recovery.update({contentSha256:'0'.repeat(64)});
    await assert.rejects(()=>sanitize());
    assert.deepEqual((await refs[0].source.get()).data(),baseline[0]);
    await refs[0].recovery.update({contentSha256:candidates[0].contentSha256});

    // A changed source must never be silently sanitized using an old baseline.
    await refs[0].source.update({nickname:'CHANGED'});
    await assert.rejects(()=>sanitize(),/B293G_SOURCE_CHANGED/);
    await refs[0].source.update({nickname:baseline[0].nickname});

    // Suspended/deleting owners cannot be sanitized by this rehearsal policy.
    await refs[0].owner.update({accountStatus:'deleted'});
    await assert.rejects(()=>sanitize(),/B293G_INPUT_DENIED/);
    await refs[0].owner.update({accountStatus:'active'});

    assert.equal(await sanitize(),2,'B293G_SANITIZE_COUNT');
    assert.equal(await sanitize(),0,'B293G_NOT_IDEMPOTENT');
    for(let i=0;i<refs.length;i++) {
      assert.deepEqual((await refs[i].source.get()).data(),
        expectedSanitizedSyntheticProfile(baseline[i]),'B293G_OTHER_FIELDS_CHANGED');
      assert.equal(hasLegacyPrivateDiscoveryFields((await refs[i].source.get()).data()),false);
      assert.equal(assessExistingRecovery(candidates[i],
        (await refs[i].recovery.get()).data()),'ALREADY_PRESERVED');
    }
    assert.deepEqual((await cleanRef.get()).data(),cleanOriginal);

    // All restoration and removal of THIS fixture's quarantine copies occur
    // atomically in the same demo transaction; real data is never touched.
    await db.runTransaction(async tx=>{
      const reads=[];
      for(const r of refs) reads.push({
        owner:await tx.get(r.owner),source:await tx.get(r.source),
        recovery:await tx.get(r.recovery),
      });
      for(let i=0;i<refs.length;i++) {
        assert.deepEqual(reads[i].owner.data(),safeOwner(),'B293G_OWNER_CHANGED');
        assert.deepEqual(reads[i].source.data(),
          expectedSanitizedSyntheticProfile(baseline[i]),'B293G_ROLLBACK_CONFLICT');
        assert.equal(assessExistingRecovery(candidates[i],
          reads[i].recovery.data()),'ALREADY_PRESERVED');
      }
      for(let i=0;i<refs.length;i++) {
        const patch=Object.fromEntries(RECOVERABLE_FIELDS
          .filter(k=>Object.hasOwn(candidates[i].legacyRaw,k))
          .map(k=>[k,structuredClone(candidates[i].legacyRaw[k])]));
        tx.update(refs[i].source,patch);
        tx.delete(refs[i].recovery);
      }
    });
    for(let i=0;i<refs.length;i++) {
      assert.deepEqual((await refs[i].source.get()).data(),baseline[i],
        'B293G_RESTORE_CONTENT_MISMATCH');
      assert.deepEqual((await refs[i].owner.get()).data(),safeOwner());
      assert.equal((await refs[i].recovery.get()).exists,false);
      assert.equal(hasLegacyPrivateDiscoveryFields((await refs[i].source.get()).data()),true);
    }
    assert.deepEqual((await cleanRef.get()).data(),cleanOriginal);
    assert.deepEqual((await cleanUser.get()).data(),safeOwner());
    const report={phase:SYNTHETIC_SANITIZATION_PHASE,result:'PASS',
      stagedCopies:2,sourceDocumentsSanitized:2,sourceDocumentsRestored:2,
      stagesIdempotent:true,sanitizationIdempotent:true,
      integrityConflictDenied:true,sourceConflictDenied:true,
      deletionLifecycleDenied:true,unrelatedFieldsPreserved:true,
      controlProfileUnchanged:true,quarantineRolledBack:true,
      realCheckpointImported:false,productionModified:false,
      primaryEmulatorModified:false,persistentWritesAllowed:false,
      sourceDeletionAllowed:false,realSanitizationAuthorized:false,
      decision:'BLOCKED'};
    const output=JSON.stringify(report);
    for(const sensitive of [...owners,'TEST_A','TEST_B','TEST_C','TEST_D',
      'TEST_E','TEST_F','TEST_G','TEST_H',...candidates.map(c=>c.contentSha256)]) {
      assert.equal(output.includes(sensitive),false,'B293G_PRIVATE_OUTPUT');
    }
    console.log(output);
  } finally {
    await db.terminate();await deleteApp(app);
  }
}
try {
  if(process.argv.length!==3) throw Error('B293G_FLAG_REQUIRED');
  if(process.argv[2]==='--preflight')await preflight();
  else if(process.argv[2]==='--exercise')await exercise();
  else throw Error('B293G_FLAG_DENIED');
} catch(err) {
  // Only expose a known, safe status key; never Firestore errors or fixture data.
  const key=typeof err?.message==='string' && /^B293G_[A-Z0-9_]+$/.test(err.message)
    ? err.message : 'B293G_EXERCISE_FAILED';
  console.error(key);process.exitCode=2;
}
