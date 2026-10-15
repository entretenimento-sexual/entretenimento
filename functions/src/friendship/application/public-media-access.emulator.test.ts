import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { db } from '../../firebaseApp';
import { ADULT_CONSENT_VERSION, TERMS_ACCEPTANCE_VERSION } from
  '../../compliance/platform-legal.constants';
import { manageUserBlock } from './manage-user-block.handler';
import { FirestoreAccountRelationshipEdgeRetentionAdapter } from '../../account_lifecycle/account-relationship-edge-retention.firestore';
import { reconcilePublicMediaAccessPair } from
  './reconcile-public-media-access.handler';

const PROJECT_ID = 'demo-entretenimento-public-media-access';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(process.env.GCLOUD_PROJECT, PROJECT_ID);
assert.match(String(host ?? ''), /^127\.0\.0\.1:\d{2,5}$/);
assert.equal(host, process.env.MEDIA_ACCESS_EXPECTED_EMULATOR_HOST);
assert.notEqual(host, '127.0.0.1:8080');
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, '');

after(async () => { await db.terminate(); });

function pair() {
  const unique = randomUUID().slice(0, 12);
  const a = 'media-a-' + unique;
  const b = 'media-b-' + unique;
  const media = (viewer: string, owner: string) =>
    db.doc(`public_media_access/${viewer}/owners/${owner}`);
  const block = (actor: string, target: string) =>
    db.doc(`users/${actor}/blocks/${target}`);
  return { a, b, media, block };
}

async function seedUsers(a: string, b: string) {
  const account = (uid: string) => ({
    uid, accountStatus: 'active', loginAllowed: true,
    acceptedTerms: {
      accepted: true, version: TERMS_ACCEPTANCE_VERSION,
      acknowledgedPrivacyNotice: true,
    },
    adultConsent: { accepted: true, version: ADULT_CONSENT_VERSION },
  });
  await Promise.all([
    db.doc(`users/${a}`).set(account(a)),
    db.doc(`users/${b}`).set(account(b)),
  ]);
}

test('block revokes both views atomically without any friendship edge', async () => {
  const { a, b, media, block } = pair();
  await seedUsers(a, b);
  await manageUserBlock({ actorUid: a, targetUid: b, action: 'block' });
  const [state, left, right] = await Promise.all([
    block(a,b).get(),media(a,b).get(),media(b,a).get(),
  ]);
  assert.equal(state.get('isBlocked'), true);
  assert.equal(left.get('available'), false);
  assert.equal(right.get('available'), false);
  assert.equal(left.get('version'), 1);
  assert.equal(left.get('ownerUid'), b);
  assert.equal(right.get('ownerUid'), a);
  for (const field of ['actorUid','direction','reason','blockedByUid']) {
    assert.equal(left.get(field), undefined);
    assert.equal(right.get(field), undefined);
  }
});

test('same-user concurrent blocks are idempotent; unblock cannot override reverse block', async () => {
  const { a, b, media } = pair();
  await seedUsers(a, b);
  await Promise.all([
    manageUserBlock({ actorUid:a, targetUid:b, action:'block' }),
    manageUserBlock({ actorUid:a, targetUid:b, action:'block' }),
  ]);
  assert.equal((await media(b,a).get()).get('available'), false);
  await manageUserBlock({ actorUid:b, targetUid:a, action:'block' });
  await manageUserBlock({ actorUid:a, targetUid:b, action:'unblock' });
  assert.equal((await media(a,b).get()).get('available'), false);
  assert.equal((await media(b,a).get()).get('available'), false);
  await manageUserBlock({ actorUid:b, targetUid:a, action:'unblock' });
  assert.equal((await media(a,b).get()).get('available'), true);
  assert.equal((await media(b,a).get()).get('available'), true);
});

test('legacy reconciliation consults both blocks and creates no reverse trace', async () => {
  const { a, b, media, block } = pair();
  await seedUsers(a, b);
  await block(b,a).set({ uid:a, actorUid:b, isBlocked:true });
  await reconcilePublicMediaAccessPair(a,b);
  assert.equal((await media(a,b).get()).get('available'), false);
  assert.equal((await media(b,a).get()).exists, false);
  await reconcilePublicMediaAccessPair(a,b);
  assert.equal((await media(b,a).get()).exists, false);
  await block(b,a).set({ uid:a, actorUid:b, isBlocked:false });
  await reconcilePublicMediaAccessPair(a,b);
  assert.equal((await media(a,b).get()).get('available'), true);
  assert.equal((await media(b,a).get()).exists, false);
});

test('parallel reconciliation and block converge to canonical active restriction', async () => {
  const {a,b,media} = pair();
  await seedUsers(a,b);
  await Promise.all([
    reconcilePublicMediaAccessPair(a,b),
    manageUserBlock({actorUid:b,targetUid:a,action:'block'}),
  ]);
  assert.equal((await media(a,b).get()).get('available'), false);
  assert.equal((await media(b,a).get()).get('available'), false);
});

test('missing owner never manufactures an authorizing projection', async () => {
  const {a,b,media} = pair();
  await seedUsers(a,b);
  await db.doc(`users/${b}`).delete();
  await reconcilePublicMediaAccessPair(a,b);
  assert.equal((await media(a,b).get()).exists,false);
});

test('block archival preserves safety audit and revokes both derived views', async () => {
  const { a, b, media, block } = pair();
  await seedUsers(a,b);
  await manageUserBlock({actorUid:a,targetUid:b,action:'block'});
  const adapter = new FirestoreAccountRelationshipEdgeRetentionAdapter();
  const result = await adapter.archiveOwnedBlockReferencePage(a,100);
  assert.equal(result.statesArchived,1);
  assert.equal((await block(a,b).get()).exists,false);
  assert.equal((await media(a,b).get()).exists,false);
  assert.equal((await media(b,a).get()).exists,false);
  const audit = await db.collection('block_security_audit')
    .where('deletedUserRole','==','owner').get();
  assert.ok(audit.docs.some(doc => doc.get('recordType')==='block_state_snapshot'));
});

test('retention removes passive references to deleted author without block edge', async () => {
  const {a,b,media} = pair();
  await seedUsers(a,b);
  await reconcilePublicMediaAccessPair(a,b);
  assert.equal((await media(a,b).get()).get('available'),true);
  const adapter = new FirestoreAccountRelationshipEdgeRetentionAdapter();
  assert.equal(await adapter.deleteInboundMediaAccessPage(b,100),1);
  assert.equal((await media(a,b).get()).exists,false);
  assert.equal(await adapter.deleteInboundMediaAccessPage(b,100),0);
});

test('retention drains owned projections and leaves unrelated users intact', async () => {
  const {a,b,media}=pair();
  await seedUsers(a,b);
  await reconcilePublicMediaAccessPair(a,b);
  const adapter=new FirestoreAccountRelationshipEdgeRetentionAdapter();
  assert.equal(await adapter.deleteOwnedMediaAccessPage(a,100),1);
  assert.equal((await media(a,b).get()).exists,false);
  assert.equal(await adapter.deleteOwnedMediaAccessPage(a,100),0);
});
