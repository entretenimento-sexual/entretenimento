// End-to-end revocation checks through REAL authenticated Media callables.
// Uses only demo project and isolated Auth/Firestore/Functions emulators.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from 'firebase/functions';
import {
  initializeApp as initializeAdminApp,
  deleteApp as deleteAdminApp,
  applicationDefault,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { seedPublicMediaCompliance } from './media-e2e-compliance-fixture.mjs';

const PROJECT = 'demo-entretenimento-media-e2e';
const HOST = '127.0.0.1';
const AUTH = 19099;
const FIRESTORE = 18080;
const FUNCTIONS = 15001;
const DURATION_MS = 10_000;
const WAIT_MS = 25_000;

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, HOST + ':' + FIRESTORE);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, HOST + ':' + AUTH);
const declaredProject = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? PROJECT;
assert.equal(declaredProject, PROJECT, 'Nunca executar contra projeto não demo.');
process.env.GCLOUD_PROJECT = PROJECT;
process.env.GCP_PROJECT = PROJECT;

const id = randomUUID();
const videoId = 'callable-video-' + id;
const photoId = 'callable-photo-' + id;
const clients = [];

function client(name) {
  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: PROJECT + '.firebaseapp.com',
    projectId: PROJECT,
    storageBucket: PROJECT + '.appspot.com',
  }, name + '-' + id);
  const auth = getAuth(app);
  const functions = getFunctions(app, 'us-central1');
  connectAuthEmulator(auth, 'http://' + HOST + ':' + AUTH, {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, HOST, FUNCTIONS);
  const value = { app, auth, functions };
  clients.push(value);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, read, accept) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const result = await read();
    if (accept(result)) return result;
    await sleep(150);
  }
  throw new Error('Timeout: ' + label);
}

async function expectError(call, data, code, reason) {
  let failure;
  try {
    await call(data);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'Callable deveria falhar com ' + code);
  assert.equal(failure.code, 'functions/' + code, String(failure.message));
  if (reason) {
    assert.equal(
      failure.details?.reason,
      reason,
      'Callable deve preservar o reason canônico.'
    );
  }
}

async function run() {
  const owner = client('owner');
  const viewer = client('viewer');
  const guest = client('guest');
  const admin = initializeAdminApp({
    credential: applicationDefault(),
    projectId: PROJECT,
    storageBucket: PROJECT + '.appspot.com',
  }, 'media-callables-' + id);
  const db = getFirestore(admin);

  try {
    const [ownerCredential, viewerCredential] = await Promise.all([
      createUserWithEmailAndPassword(
        owner.auth, 'callable-owner-' + id + '@example.test', 'Owner-' + id + '-Aa1!'
      ),
      createUserWithEmailAndPassword(
        viewer.auth, 'callable-viewer-' + id + '@example.test', 'Viewer-' + id + '-Aa1!'
      ),
    ]);
    const ownerUid = ownerCredential.user.uid;
    const viewerUid = viewerCredential.user.uid;
    const ownerRef = db.doc('users/' + ownerUid);
    const viewerRef = db.doc('users/' + viewerUid);
    const profileRef = db.doc('public_profiles/' + ownerUid);
    const photoRef = profileRef.collection('public_photos').doc(photoId);
    const videoRef = profileRef.collection('public_videos').doc(videoId);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const viewRef = videoRef.collection('views').doc(viewerUid);
    const sessionRef = videoRef.collection('playback_sessions').doc(viewerUid);
    const ownerBlockRef = ownerRef.collection('blocks').doc(viewerUid);
    const viewerBlockRef = viewerRef.collection('blocks').doc(ownerUid);

    await waitFor(
      'criação canônica das contas',
      async () => (await Promise.all([ownerRef.get(), viewerRef.get()])).every(s => s.exists),
      Boolean
    );
    await seedPublicMediaCompliance(db, [ownerUid, viewerUid]);

    const assetVersion = Date.now();
    await Promise.all([
      profileRef.set({
        uid: ownerUid,
        nickname: 'Media callable owner',
        mediaCount: 2,
        photosCount: 1,
        videosCount: 1,
      }, { merge: true }),
      photoRef.set({
        id: photoId,
        ownerUid,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        mediaType: 'PHOTO',
        viewsCount: 0,
        uniqueViewersCount: 0,
        reactionsCount: 0,
        publishedAt: Date.now(),
      }),
      publicationRef.set({
        ownerUid,
        videoId,
        isPublished: true,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        assetVersion,
      }),
      videoRef.set({
        id: videoId,
        ownerUid,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        mediaType: 'VIDEO',
        durationMs: DURATION_MS,
        assetVersion,
        publishedAt: assetVersion,
        viewsCount: 0,
        uniqueViewersCount: 0,
        viewScore: 0,
        reactionsCount: 0,
        commentsCount: 0,
        reactionsEnabled: true,
        commentsEnabled: true,
        ratingsCount: 0,
        retentionContributorsCount: 0,
        scoreBreakdown: { audienceScore: 0, retentionScore: 0 },
      }),
    ]);

    const start = httpsCallable(viewer.functions, 'startPublicVideoPlaybackSession');
    const anonymousStart = httpsCallable(guest.functions, 'startPublicVideoPlaybackSession');
    const photoView = httpsCallable(viewer.functions, 'recordPhotoView');
    const videoView = httpsCallable(viewer.functions, 'recordVideoView');
    const retention = httpsCallable(viewer.functions, 'recordVideoRetention');
    const reaction = httpsCallable(viewer.functions, 'toggleVideoReaction');
    const comment = httpsCallable(viewer.functions, 'createVideoComment');
    const videoPayload = { ownerUid, videoId };
    const photoPayload = { ownerUid, photoId, source: 'profile' };

    await expectError(anonymousStart, videoPayload, 'unauthenticated');
    assert.equal((await sessionRef.get()).exists, false);
    console.log('[media-callables:e2e] PASS authentication boundary');

    const first = (await start(videoPayload)).data;
    assert.ok(first.playbackToken);
    assert.equal((await sessionRef.get()).exists, true);
    const photoSuccess = (await photoView(photoPayload)).data;
    assert.equal(photoSuccess.ok, true);
    assert.equal((await photoRef.get()).data().viewsCount, 1);
    console.log('[media-callables:e2e] PASS active visitor playback/photo');

    const tokenBeforeRevocation = (await sessionRef.get()).data().tokenHash;
    await viewerRef.update({ suspended: true });
    await expectError(start, videoPayload, 'failed-precondition', 'ACCOUNT_UNAVAILABLE');
    await expectError(photoView, photoPayload, 'failed-precondition', 'ACCOUNT_UNAVAILABLE');
    assert.equal((await sessionRef.get()).data().tokenHash, tokenBeforeRevocation);
    assert.equal((await photoRef.get()).data().viewsCount, 1);
    console.log('[media-callables:e2e] PASS viewer suspension revokes playback/photo');

    await viewerRef.update({ suspended: false });
    await ownerBlockRef.set({ isBlocked: true, uid: viewerUid, actorUid: ownerUid });
    await expectError(start, videoPayload, 'not-found');
    await expectError(photoView, photoPayload, 'not-found');
    assert.equal((await photoRef.get()).data().viewsCount, 1);
    console.log('[media-callables:e2e] PASS owner-to-viewer block');

    await ownerBlockRef.set({ isBlocked: false }, { merge: true });
    const blockedSession = (await start(videoPayload)).data;
    await viewerBlockRef.set({ isBlocked: true, uid: ownerUid, actorUid: viewerUid });
    await sleep(Math.max(0, blockedSession.earliestQualifiedAt - Date.now() + 250));
    const evidence = {
      sessionId: randomUUID().replaceAll('-', ''),
      playbackMs: blockedSession.requiredPlaybackMs,
      durationMs: DURATION_MS,
      qualifiedAt: Date.now(),
    };
    await expectError(videoView, {
      ...videoPayload, playbackToken: blockedSession.playbackToken, evidence,
    }, 'not-found');
    assert.equal((await viewRef.get()).exists, false);
    assert.equal((await videoRef.get()).data().viewsCount, 0);
    console.log('[media-callables:e2e] PASS viewer-to-owner block revokes valid session');

    await viewerBlockRef.set({ isBlocked: false }, { merge: true });
    const allowedSession = (await start(videoPayload)).data;
    await sleep(Math.max(0, allowedSession.earliestQualifiedAt - Date.now() + 250));
    const qualifiedEvidence = {
      sessionId: randomUUID().replaceAll('-', ''),
      playbackMs: allowedSession.requiredPlaybackMs,
      durationMs: DURATION_MS,
      qualifiedAt: Date.now(),
    };
    const approvedView = (await videoView({
      ...videoPayload,
      playbackToken: allowedSession.playbackToken,
      evidence: qualifiedEvidence,
      source: 'profile',
    })).data;
    assert.equal(approvedView.ok, true);
    assert.equal(approvedView.counted, true);
    assert.ok(approvedView.retentionToken);
    assert.equal((await videoRef.get()).data().viewsCount, 1);
    console.log('[media-callables:e2e] PASS qualified authenticated video view');

    // recordVideoView already persists the first qualified retention sample.
    // A later retention update only improves totals for genuinely MORE playback.
    const initialRetentionBasisPoints = (await videoRef.get()).data().retentionBasisPointsTotal;
    assert.ok(initialRetentionBasisPoints > 0);
    const retentionPayload = {
      ...videoPayload,
      retentionToken: approvedView.retentionToken,
      evidence: {
        sessionId: randomUUID().replaceAll('-', ''),
        playbackMs: Math.min(DURATION_MS, allowedSession.requiredPlaybackMs + 1_000),
        durationMs: DURATION_MS,
        qualifiedAt: Date.now(),
      },
    };
    const acceptedRetention = (await retention(retentionPayload)).data;
    assert.equal(acceptedRetention.ok, true);
    assert.equal(acceptedRetention.improved, true);
    const retentionBefore = (await videoRef.get()).data().retentionBasisPointsTotal;
    assert.ok(retentionBefore > initialRetentionBasisPoints);
    console.log('[media-callables:e2e] PASS qualified video retention');

    await viewerRef.update({ suspended: true });
    await expectError(retention, retentionPayload, 'failed-precondition', 'ACCOUNT_UNAVAILABLE');
    assert.equal((await videoRef.get()).data().retentionBasisPointsTotal, retentionBefore);
    await viewerRef.update({ suspended: false });
    await ownerBlockRef.set({ isBlocked: true }, { merge: true });
    await expectError(retention, retentionPayload, 'not-found');
    assert.equal((await videoRef.get()).data().retentionBasisPointsTotal, retentionBefore);
    console.log('[media-callables:e2e] PASS retention revocation preserves totals');

    await ownerBlockRef.set({ isBlocked: false }, { merge: true });
    await ownerRef.update({ suspended: true });
    await expectError(start, videoPayload, 'not-found');
    assert.equal((await videoRef.get()).data().viewsCount, 1);
    console.log('[media-callables:e2e] PASS owner suspension revokes new session');

    // An approved public projection is not sufficient when the authoritative
    // publication is flagged. This also fences tokens issued before the hold.
    await ownerRef.update({ suspended: false });
    const sessionBeforeHold = (await start(videoPayload)).data;
    await publicationRef.update({ moderationStatus: 'FLAGGED' });
    // Let the projection synchronization finish, then deliberately model its
    // lag behind an already committed canonical restriction. The transaction
    // must still deny new sessions and accounting for the pre-hold token.
    await waitFor(
      'projeção sincronizada com moderação',
      async () => (await videoRef.get()).get('moderationStatus'),
      (status) => status === 'FLAGGED'
    );
    await videoRef.update({ moderationStatus: 'APPROVED' });
    await expectError(start, videoPayload, 'not-found');
    const socialBefore = (await videoRef.get()).data();
    await expectError(reaction, videoPayload, 'not-found');
    await expectError(comment, { ...videoPayload, content: 'Blocked after hold' }, 'not-found');
    const socialAfter = (await videoRef.get()).data();
    assert.equal(socialAfter.reactionsCount, socialBefore.reactionsCount);
    assert.equal(socialAfter.commentsCount, socialBefore.commentsCount);
    assert.equal(socialAfter.score, socialBefore.score);
    console.log('[media-callables:e2e] PASS canonical hold revokes reactions/comments without score changes');
    await expectError(retention, retentionPayload, 'not-found');
    await sleep(Math.max(0, sessionBeforeHold.earliestQualifiedAt - Date.now() + 250));
    const postHoldEvidence = {
      sessionId: randomUUID().replaceAll('-', ''),
      playbackMs: sessionBeforeHold.requiredPlaybackMs,
      durationMs: DURATION_MS,
      qualifiedAt: Date.now(),
    };
    await expectError(videoView, {
      ...videoPayload,
      playbackToken: sessionBeforeHold.playbackToken,
      evidence: postHoldEvidence,
      source: 'profile',
    }, 'not-found');
    assert.equal((await videoRef.get()).data().viewsCount, 1);
    assert.equal((await videoRef.get()).data().retentionBasisPointsTotal, retentionBefore);
    console.log('[media-callables:e2e] PASS canonical publication hold revokes playback and metrics');

    await publicationRef.update({ moderationStatus: 'APPROVED', isPublished: false });
    await expectError(start, videoPayload, 'not-found');
    await expectError(reaction, videoPayload, 'not-found');
    await expectError(comment, { ...videoPayload, content: 'Blocked after unpublish' }, 'not-found');
    console.log('[media-callables:e2e] PASS unpublish denies stale public projection and social writes');
    console.log('[media-callables:e2e] PASS all authenticated media callable boundaries');
  } finally {
    await Promise.allSettled(clients.map((value) => deleteApp(value.app)));
    await deleteAdminApp(admin);
  }
}

run().catch((error) => {
  console.error('[media-callables:e2e] FAILED:', error);
  process.exitCode = 1;
});
