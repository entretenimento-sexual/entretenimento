import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db, Timestamp } from '../../../firebaseApp';
import { stageDirectChatDiscoveryInvalidation } from './direct-chat-discovery.references';
import { TERMS_ACCEPTANCE_VERSION } from '../../../compliance/platform-legal.constants';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run('CHAT-R1.5 authorized discovery', () => {
  it('retains unindexed histories, excludes both block directions and unrelated chats', async () => {
    const prefix = 'r15-' + randomUUID();
    const owner = prefix + '-owner', peer = prefix + '-peer', outsider = prefix + '-other';
    const history = prefix + '-history', foreign = prefix + '-foreign';
    const user = (uid: string) => ({
      uid, profileCompleted: true, accountStatus: 'active',
      acceptedTerms: { accepted: true, version: TERMS_ACCEPTANCE_VERSION,
        termsDocumentVersion: '2026-09-29.1', privacyNoticeVersion: '2026-09-29.1',
        acknowledgedPrivacyNotice: true },
    });
    const environment = require('firebase-functions-test')({
      projectId: process.env.GCLOUD_PROJECT || 'demo-entretenimento',
    });
    const invoke = environment.wrap(require('./list-direct-chat-candidates.handler').listDirectChatCandidates);
    const request = (verified = true, data: Record<string, unknown> = {}) => invoke({ data,
      app: { appId: 'test-chat-app' },
      auth: { uid: owner, token: { email_verified: verified } } }, {});
    try {
      await Promise.all([owner, peer, outsider].map(uid => db.doc('users/' + uid).set(user(uid))));
      await db.doc('chats/' + history).set({ participants: [owner, peer] });
      await db.doc('chats/' + foreign).set({ participants: [peer, outsider] });
      await assert.rejects(request(false), { code: 'failed-precondition' });
      assert.deepEqual(await request(), { chatIds: [history] });
      assert.deepEqual(await request(true, { chatId: history }), { chatIds: [history] });
      assert.deepEqual(await request(true, { chatId: foreign }), { chatIds: [] });
      assert.deepEqual(await request(true, { chatId: prefix + '-missing' }), { chatIds: [] });
      await assert.rejects(request(true, { chatId: history, pageSize: 1 }), { code: 'invalid-argument' });
      for (const [a, b] of [[owner, peer], [peer, owner]]) {
        const block = db.doc('users/' + a + '/blocks/' + b);
        await block.set({ isBlocked: true });
        assert.deepEqual(await request(), { chatIds: [] });
        assert.deepEqual(await request(true, { chatId: history }), { chatIds: [] });
        await block.delete();
      }
      assert.deepEqual(await request(), { chatIds: [history] });
      await db.doc('users/' + peer).update({ accountStatus: 'deleted' });
      assert.deepEqual(await request(), { chatIds: [] });
      assert.deepEqual(await request(true, { chatId: history }), { chatIds: [] });
      assert.equal((await db.doc('chats/' + history).get()).exists, true);
    } finally {
      await Promise.all([owner, peer, outsider].map(uid => db.recursiveDelete(db.doc('users/' + uid))));
      await Promise.all([history, foreign].map(id => db.doc('chats/' + id).delete()));
      environment.cleanup();
    }
  });

  it('paginates over 500 histories without returning denied identifiers or accepting foreign cursors', async () => {
    const prefix = 'r103-' + randomUUID();
    const owner = prefix + '-owner', peer = prefix + '-peer', denied = prefix + '-denied', outsider = prefix + '-other';
    const users = [owner, peer, denied, outsider];
    const root = (uid: string) => db.doc('direct_chat_discovery/' + uid);
    const user = (uid: string) => ({
      uid, profileCompleted: true, accountStatus: 'active',
      acceptedTerms: { accepted: true, version: TERMS_ACCEPTANCE_VERSION,
        termsDocumentVersion: '2026-09-29.1', privacyNoticeVersion: '2026-09-29.1',
        acknowledgedPrivacyNotice: true },
    });
    const environment = require('firebase-functions-test')({
      projectId: process.env.GCLOUD_PROJECT || 'demo-entretenimento',
    });
    const invoke = environment.wrap(require('./list-direct-chat-candidates.handler').listDirectChatCandidates);
    const request = (data: Record<string, unknown>, uid = owner, verified = true) =>
      invoke({ data, app: { appId: 'test-chat-app' }, auth: { uid, token: { email_verified: verified } } }, {});
    const hidden = Array.from({length:100}, (_,i) => prefix + '-a-hidden-' + String(i).padStart(4,'0'));
    const visible = Array.from({length:501}, (_,i) => prefix + '-b-history-' + String(i).padStart(4,'0'));
    const foreign = prefix + '-c-foreign';
    const all = [...hidden,...visible,foreign];
    const cursorDoc = (token: string) => root(owner).collection('direct_chat_page_cursors')
      .doc(createHash('sha256').update(token).digest('hex'));
    try {
      await Promise.all(users.map(uid => db.doc('users/' + uid).set(user(uid))));
      await root(owner).set({version:1,revision:1});
      await db.doc('users/' + denied + '/blocks/' + owner).set({isBlocked:true});
      for(let offset=0;offset<all.length;offset+=350) {
        const batch = db.batch();
        for(const id of all.slice(offset,offset+350)) {
          const participants = id === foreign ? [peer,outsider] : [owner, id.includes('-a-hidden-') ? denied : peer];
          batch.set(db.doc('chats/'+id),{participants});
        }
        await batch.commit();
      }
      await assert.rejects(request({}), {code:'resource-exhausted'});
      assert.deepEqual(await request({chatId:visible[500]}),{chatIds:[visible[500]]});
      await assert.rejects(request({pageSize:101}), {code:'invalid-argument'});
      await assert.rejects(request({pageSize:100,cursor:'raw-id'}), {code:'invalid-argument'});
      await assert.rejects(request({pageSize:100},owner,false), {code:'failed-precondition'});
      const first = await request({pageSize:100});
      assert.deepEqual(first.chatIds,[]);
      assert.match(first.nextCursor,/^[A-Za-z0-9_-]{43}$/);
      assert.equal(first.revision,1);
      await assert.rejects(request({pageSize:100,cursor:first.nextCursor},outsider), {code:'failed-precondition'});
      await assert.rejects(request({pageSize:99,cursor:first.nextCursor}), {code:'failed-precondition'});
      const ids: string[] = [];
      let cursor: string | null = first.nextCursor;
      let pages=0;
      while(cursor) {
        assert.ok(++pages<=7);
        const result = await request({pageSize:100,cursor});
        assert.equal(result.revision,1);
        assert.ok(result.chatIds.length<=100);
        ids.push(...result.chatIds);
        cursor=result.nextCursor;
      }
      assert.deepEqual(ids,visible);
      assert.equal(new Set(ids).size,501);
      const retry = await request({pageSize:100,cursor:first.nextCursor});
      assert.deepEqual(retry.chatIds,visible.slice(0,100));
      await cursorDoc(first.nextCursor).update({expiresAt:Timestamp.fromMillis(Date.now()-1)});
      await assert.rejects(request({pageSize:100,cursor:first.nextCursor}), {code:'failed-precondition'});
      await db.runTransaction(async tx => stageDirectChatDiscoveryInvalidation(tx,owner));
      await assert.rejects(request({pageSize:100,cursor:retry.nextCursor}), {code:'failed-precondition'});
      // Fresh validation still denies outgoing blocks without relying on the revision.
      await db.doc('users/'+owner+'/blocks/'+peer).set({isBlocked:true});
      const deniedPage=await request({pageSize:100});
      assert.deepEqual(deniedPage.chatIds,[]);
      assert.deepEqual((await request({pageSize:100,cursor:deniedPage.nextCursor})).chatIds,[]);
    } finally {
      for(let offset=0;offset<all.length;offset+=350) {
        const batch=db.batch();
        for(const id of all.slice(offset,offset+350)) batch.delete(db.doc('chats/'+id));
        await batch.commit();
      }
      await Promise.all(users.flatMap(uid=>[db.recursiveDelete(db.doc('users/'+uid)),db.recursiveDelete(root(uid))]));
      environment.cleanup();
    }
  });

});
