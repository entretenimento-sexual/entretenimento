import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  deleteApp as deleteClientApp,
  initializeApp as initializeClientApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from 'firebase/auth';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  applicationDefault,
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${AUTH_PORT}`;

function createClientApp(name) {
  const app = initializeClientApp(
    {
      apiKey: 'fake-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    name
  );
  const auth = getAuth(app);
  const functions = getFunctions(app, 'us-central1');

  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);

  return { app, auth, functions };
}

function userDocument(uid, email, nickname) {
  const now = Date.now();

  return {
    uid,
    email,
    nickname,
    nicknameNormalized: nickname.toLowerCase().replace(/\s+/g, '-'),
    role: 'free',
    tier: 'free',
    emailVerified: true,
    profileCompleted: true,
    accountStatus: 'active',
    publicVisibility: 'visible',
    interactionBlocked: false,
    loginAllowed: true,
    suspended: false,
    initialAdultConsentRequired: false,
    adultConsent: {
      accepted: true,
      version: 'v1',
      acceptedAt: now,
    },
    acceptedTerms: {
      accepted: true,
      version: 'v1',
      acceptedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

async function expectCallableFailure(callable, payload, expectedCode) {
  try {
    await callable(payload);
  } catch (error) {
    assert.ok(error, 'A Callable deveria rejeitar a operação.');
    if (expectedCode) {
      assert.equal(error.code, `functions/${expectedCode}`);
    }
    return;
  }

  assert.fail('A Callable aceitou uma operação que deveria ser rejeitada.');
}

async function readData(reference) {
  const snapshot = await reference.get();
  return snapshot.exists ? snapshot.data() : null;
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);

  const runId = randomUUID();
  const shortRunId = runId.slice(0, 8);
  const communityId = `community-topics-${runId}`;
  const memberEmail = `topics-member-${runId}@example.test`;
  const moderatorEmail = `topics-moderator-${runId}@example.test`;
  const visitorEmail = `topics-visitor-${runId}@example.test`;
  const memberClient = createClientApp(`topics-member-${runId}`);
  const moderatorClient = createClientApp(`topics-moderator-${runId}`);
  const visitorClient = createClientApp(`topics-visitor-${runId}`);
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    },
    `topics-admin-${runId}`
  );
  const db = getFirestore(adminApp);
  const adminAuth = getAdminAuth(adminApp);

  let memberUid = '';
  let moderatorUid = '';
  let visitorUid = '';

  try {
    const [memberCredential, moderatorCredential, visitorCredential] =
      await Promise.all([
        createUserWithEmailAndPassword(
          memberClient.auth,
          memberEmail,
          `Member-${runId}-Aa1!`
        ),
        createUserWithEmailAndPassword(
          moderatorClient.auth,
          moderatorEmail,
          `Moderator-${runId}-Aa1!`
        ),
        createUserWithEmailAndPassword(
          visitorClient.auth,
          visitorEmail,
          `Visitor-${runId}-Aa1!`
        ),
      ]);

    memberUid = memberCredential.user.uid;
    moderatorUid = moderatorCredential.user.uid;
    visitorUid = visitorCredential.user.uid;

    await Promise.all([
      adminAuth.updateUser(memberUid, { emailVerified: true }),
      adminAuth.updateUser(moderatorUid, { emailVerified: true }),
      adminAuth.updateUser(visitorUid, { emailVerified: true }),
    ]);
    await Promise.all([
      memberCredential.user.getIdToken(true),
      moderatorCredential.user.getIdToken(true),
      visitorCredential.user.getIdToken(true),
    ]);

    const now = Date.now();
    const communityRef = db.doc(`communities/${communityId}`);

    await Promise.all([
      db.doc(`users/${memberUid}`).set(
        userDocument(memberUid, memberEmail, `Membro ${shortRunId}`)
      ),
      db.doc(`users/${moderatorUid}`).set(
        userDocument(
          moderatorUid,
          moderatorEmail,
          `Moderador ${shortRunId}`
        )
      ),
      db.doc(`users/${visitorUid}`).set(
        userDocument(visitorUid, visitorEmail, `Visitante ${shortRunId}`)
      ),
      communityRef.set({
        name: `Comunidade E2E ${shortRunId}`,
        slug: `community-e2e-${shortRunId}`,
        description: 'Fixture isolada para validar Tópicos no Emulator.',
        source: { type: 'community', id: communityId },
        status: 'active',
        visibility: 'public_preview',
        access: {
          preview: 'authenticated',
          interaction: 'members_only',
          join: 'open',
        },
        moderation: {
          state: 'active',
          reviewedAt: now,
          reviewedBy: 'community-topics-e2e',
        },
        lifecycle: {
          lastMeaningfulActivityAt: now,
        },
        metrics: {
          memberCount: 2,
          postCount: 0,
          mediaCount: 0,
        },
        createdAt: now,
        updatedAt: now,
      }),
      communityRef.collection('members').doc(memberUid).set({
        uid: memberUid,
        role: 'member',
        status: 'active',
        joinedAt: now,
        updatedAt: now,
      }),
      communityRef.collection('members').doc(moderatorUid).set({
        uid: moderatorUid,
        role: 'moderator',
        status: 'active',
        joinedAt: now,
        updatedAt: now,
      }),
    ]);

    const createTopicAsMember = httpsCallable(
      memberClient.functions,
      'createCommunityTopic'
    );
    const createTopicAsVisitor = httpsCallable(
      visitorClient.functions,
      'createCommunityTopic'
    );
    const createReplyAsMember = httpsCallable(
      memberClient.functions,
      'createCommunityTopicReply'
    );
    const createReplyAsVisitor = httpsCallable(
      visitorClient.functions,
      'createCommunityTopicReply'
    );
    const moderateTopicAsMember = httpsCallable(
      memberClient.functions,
      'moderateCommunityTopic'
    );
    const moderateTopicAsModerator = httpsCallable(
      moderatorClient.functions,
      'moderateCommunityTopic'
    );
    const getTopicsAsMember = httpsCallable(
      memberClient.functions,
      'getCommunityTopicsPage'
    );
    const getTopicsAsVisitor = httpsCallable(
      visitorClient.functions,
      'getCommunityTopicsPage'
    );
    const getDetailAsMember = httpsCallable(
      memberClient.functions,
      'getCommunityTopicDetail'
    );
    const getDetailAsVisitor = httpsCallable(
      visitorClient.functions,
      'getCommunityTopicDetail'
    );
    const getRepliesAsMember = httpsCallable(
      memberClient.functions,
      'getCommunityTopicRepliesPage'
    );

    const emptyVisitorPage = await getTopicsAsVisitor({
      communityId,
      limit: 12,
    });
    assert.deepEqual(emptyVisitorPage.data.items, []);

    await expectCallableFailure(
      createTopicAsVisitor,
      {
        requestId: `visitor-denied-${shortRunId}`,
        communityId,
        title: 'Visitante não pode publicar',
        body: 'Esta criação deve ser rejeitada pelo backend.',
        audience: 'public_preview',
      },
      'permission-denied'
    );

    const memberTopicRequestId = `member-topic-${runId}`;
    const memberTopicPayload = {
      requestId: memberTopicRequestId,
      communityId,
      title: 'Discussão reservada aos membros',
      body: 'Conteúdo integral do Tópico reservado para integrantes ativos.',
      audience: 'members_only',
    };

    const firstTopicWrite = await createTopicAsMember(memberTopicPayload);
    assert.equal(firstTopicWrite.data.topicId, memberTopicRequestId);
    assert.equal(firstTopicWrite.data.created, true);
    assert.equal(firstTopicWrite.data.deduplicated, false);

    const repeatedTopicWrite = await createTopicAsMember(memberTopicPayload);
    assert.equal(repeatedTopicWrite.data.topicId, memberTopicRequestId);
    assert.equal(repeatedTopicWrite.data.created, false);
    assert.equal(repeatedTopicWrite.data.deduplicated, true);

    const visitorAfterMembersOnly = await getTopicsAsVisitor({
      communityId,
      limit: 12,
    });
    assert.deepEqual(visitorAfterMembersOnly.data.items, []);

    const memberPage = await getTopicsAsMember({ communityId, limit: 12 });
    assert.equal(memberPage.data.items.length, 1);
    assert.equal(memberPage.data.items[0].topicId, memberTopicRequestId);
    assert.equal(memberPage.data.items[0].title, memberTopicPayload.title);
    assert.equal('audience' in memberPage.data.items[0], false);

    await expectCallableFailure(
      getDetailAsVisitor,
      { communityId, topicId: memberTopicRequestId },
      'permission-denied'
    );

    const memberDetail = await getDetailAsMember({
      communityId,
      topicId: memberTopicRequestId,
    });
    assert.equal(memberDetail.data.topic.body, memberTopicPayload.body);
    assert.equal(memberDetail.data.canReply, true);

    const replyRequestId = `member-reply-${runId}`;
    const replyPayload = {
      requestId: replyRequestId,
      communityId,
      topicId: memberTopicRequestId,
      body: 'Resposta persistente criada pelo membro ativo.',
    };

    const firstReplyWrite = await createReplyAsMember(replyPayload);
    assert.equal(firstReplyWrite.data.replyId, replyRequestId);
    assert.equal(firstReplyWrite.data.replyCount, 1);
    assert.equal(firstReplyWrite.data.created, true);
    assert.equal(firstReplyWrite.data.deduplicated, false);

    const repeatedReplyWrite = await createReplyAsMember(replyPayload);
    assert.equal(repeatedReplyWrite.data.replyId, replyRequestId);
    assert.equal(repeatedReplyWrite.data.replyCount, 1);
    assert.equal(repeatedReplyWrite.data.created, false);
    assert.equal(repeatedReplyWrite.data.deduplicated, true);

    const repliesPage = await getRepliesAsMember({
      communityId,
      topicId: memberTopicRequestId,
      limit: 20,
    });
    assert.equal(repliesPage.data.items.length, 1);
    assert.equal(repliesPage.data.items[0].replyId, replyRequestId);
    assert.equal(repliesPage.data.items[0].body, replyPayload.body);

    await expectCallableFailure(
      createReplyAsVisitor,
      {
        requestId: `visitor-reply-${shortRunId}`,
        communityId,
        topicId: memberTopicRequestId,
        body: 'Visitante não pode responder.',
      },
      'permission-denied'
    );

    const projectedReplyBeforeModeration = await readData(
      db.doc(
        `community_public_topics/${communityId}/items/${memberTopicRequestId}/replies/${replyRequestId}`
      )
    );
    assert.equal('actorUid' in projectedReplyBeforeModeration, false);
    assert.equal(projectedReplyBeforeModeration.body, replyPayload.body);

    const lockRequestId = `moderation-lock-${runId}`;
    const lockPayload = {
      requestId: lockRequestId,
      communityId,
      topicId: memberTopicRequestId,
      action: 'lock',
      reason: 'Discussão temporariamente encerrada para revisão.',
    };

    await expectCallableFailure(
      moderateTopicAsMember,
      lockPayload,
      'permission-denied'
    );

    const firstLock = await moderateTopicAsModerator(lockPayload);
    assert.equal(firstLock.data.action, 'lock');
    assert.equal(firstLock.data.status, 'locked');
    assert.equal(firstLock.data.moderationState, 'active');
    assert.equal(firstLock.data.deduplicated, false);

    const repeatedLock = await moderateTopicAsModerator(lockPayload);
    assert.equal(repeatedLock.data.status, 'locked');
    assert.equal(repeatedLock.data.moderationState, 'active');
    assert.equal(repeatedLock.data.deduplicated, true);

    const lockedDetail = await getDetailAsMember({
      communityId,
      topicId: memberTopicRequestId,
    });
    assert.equal(lockedDetail.data.topic.status, 'locked');
    assert.equal(lockedDetail.data.canReply, false);

    await expectCallableFailure(
      createReplyAsMember,
      {
        requestId: `reply-while-locked-${runId}`,
        communityId,
        topicId: memberTopicRequestId,
        body: 'Esta resposta deve ser bloqueada enquanto o Tópico está encerrado.',
      },
      'failed-precondition'
    );

    const unlockRequestId = `moderation-unlock-${runId}`;
    const unlockResult = await moderateTopicAsModerator({
      requestId: unlockRequestId,
      communityId,
      topicId: memberTopicRequestId,
      action: 'unlock',
      reason: 'Revisão concluída; discussão liberada novamente.',
    });
    assert.equal(unlockResult.data.action, 'unlock');
    assert.equal(unlockResult.data.status, 'active');
    assert.equal(unlockResult.data.moderationState, 'active');
    assert.equal(unlockResult.data.deduplicated, false);

    const reopenedDetail = await getDetailAsMember({
      communityId,
      topicId: memberTopicRequestId,
    });
    assert.equal(reopenedDetail.data.topic.status, 'active');
    assert.equal(reopenedDetail.data.canReply, true);

    const replyAfterUnlockRequestId = `reply-after-unlock-${runId}`;
    const replyAfterUnlock = await createReplyAsMember({
      requestId: replyAfterUnlockRequestId,
      communityId,
      topicId: memberTopicRequestId,
      body: 'Resposta criada depois da reabertura pelo moderador.',
    });
    assert.equal(replyAfterUnlock.data.replyId, replyAfterUnlockRequestId);
    assert.equal(replyAfterUnlock.data.replyCount, 2);
    assert.equal(replyAfterUnlock.data.created, true);
    assert.equal(replyAfterUnlock.data.deduplicated, false);

    const repliesAfterUnlock = await getRepliesAsMember({
      communityId,
      topicId: memberTopicRequestId,
      limit: 20,
    });
    assert.equal(repliesAfterUnlock.data.items.length, 2);
    assert.deepEqual(
      repliesAfterUnlock.data.items.map((item) => item.replyId),
      [replyRequestId, replyAfterUnlockRequestId]
    );

    const removeRequestId = `moderation-remove-${runId}`;
    const removeReason = 'Tópico removido no E2E para validar auditoria e retenção.';
    const removePayload = {
      requestId: removeRequestId,
      communityId,
      topicId: memberTopicRequestId,
      action: 'remove',
      reason: removeReason,
    };
    const firstRemove = await moderateTopicAsModerator(removePayload);
    assert.equal(firstRemove.data.action, 'remove');
    assert.equal(firstRemove.data.status, 'archived');
    assert.equal(firstRemove.data.moderationState, 'removed');
    assert.equal(firstRemove.data.deduplicated, false);

    const repeatedRemove = await moderateTopicAsModerator(removePayload);
    assert.equal(repeatedRemove.data.status, 'archived');
    assert.equal(repeatedRemove.data.moderationState, 'removed');
    assert.equal(repeatedRemove.data.deduplicated, true);

    await expectCallableFailure(
      getDetailAsMember,
      { communityId, topicId: memberTopicRequestId },
      'not-found'
    );

    const memberPageAfterRemoval = await getTopicsAsMember({
      communityId,
      limit: 12,
    });
    assert.deepEqual(memberPageAfterRemoval.data.items, []);

    const operationalTopicAfterRemoval = await readData(
      db.doc(`community_topics/${communityId}/items/${memberTopicRequestId}`)
    );
    const projectionAfterRemoval = await readData(
      db.doc(`community_public_topics/${communityId}/items/${memberTopicRequestId}`)
    );
    const operationalReplyAfterRemoval = await readData(
      db.doc(
        `community_topics/${communityId}/items/${memberTopicRequestId}/replies/${replyRequestId}`
      )
    );
    const operationalReplyAfterUnlock = await readData(
      db.doc(
        `community_topics/${communityId}/items/${memberTopicRequestId}/replies/${replyAfterUnlockRequestId}`
      )
    );
    const lockAudit = await readData(
      db.doc(`community_topic_audit/moderation-${lockRequestId}`)
    );
    const unlockAudit = await readData(
      db.doc(`community_topic_audit/moderation-${unlockRequestId}`)
    );
    const removeAudit = await readData(
      db.doc(`community_topic_audit/moderation-${removeRequestId}`)
    );

    assert.equal(operationalTopicAfterRemoval.actorUid, memberUid);
    assert.equal(operationalTopicAfterRemoval.status, 'archived');
    assert.equal(operationalTopicAfterRemoval.moderationState, 'removed');
    assert.equal(operationalTopicAfterRemoval.moderatedBy, moderatorUid);
    assert.equal(operationalTopicAfterRemoval.moderationReason, removeReason);
    assert.equal(operationalTopicAfterRemoval.metrics.replyCount, 2);
    assert.equal(projectionAfterRemoval, null);
    assert.equal(operationalReplyAfterRemoval.actorUid, memberUid);
    assert.equal(operationalReplyAfterUnlock.actorUid, memberUid);

    assert.equal(lockAudit.action, 'community-topic-locked');
    assert.equal(lockAudit.actorUid, moderatorUid);
    assert.equal(lockAudit.actorRole, 'moderator');
    assert.equal(lockAudit.previousStatus, 'active');
    assert.equal(lockAudit.nextStatus, 'locked');

    assert.equal(unlockAudit.action, 'community-topic-unlocked');
    assert.equal(unlockAudit.actorUid, moderatorUid);
    assert.equal(unlockAudit.actorRole, 'moderator');
    assert.equal(unlockAudit.previousStatus, 'locked');
    assert.equal(unlockAudit.nextStatus, 'active');

    assert.equal(removeAudit.action, 'community-topic-removed');
    assert.equal(removeAudit.actorUid, moderatorUid);
    assert.equal(removeAudit.actorRole, 'moderator');
    assert.equal(removeAudit.previousStatus, 'active');
    assert.equal(removeAudit.nextStatus, 'archived');
    assert.equal(removeAudit.nextModerationState, 'removed');
    assert.equal(removeAudit.reason, removeReason);

    const publicTopicRequestId = `public-topic-${runId}`;
    const publicTopicPayload = {
      requestId: publicTopicRequestId,
      communityId,
      title: 'Discussão visível na prévia',
      body: 'Visitantes autenticados podem ler, mas não interagir.',
      audience: 'public_preview',
    };
    await createTopicAsMember(publicTopicPayload);

    const visitorPublicPage = await getTopicsAsVisitor({
      communityId,
      limit: 12,
    });
    assert.equal(visitorPublicPage.data.items.length, 1);
    assert.equal(visitorPublicPage.data.items[0].topicId, publicTopicRequestId);

    const visitorPublicDetail = await getDetailAsVisitor({
      communityId,
      topicId: publicTopicRequestId,
    });
    assert.equal(visitorPublicDetail.data.topic.body, publicTopicPayload.body);
    assert.equal(visitorPublicDetail.data.canReply, false);

    const publicTopicProjection = await readData(
      db.doc(`community_public_topics/${communityId}/items/${publicTopicRequestId}`)
    );
    assert.equal('actorUid' in publicTopicProjection, false);
    assert.equal('body' in publicTopicProjection, false);

    console.log(
      '[community-topics:e2e] Fluxo real de Tópicos e moderação validado com sucesso.'
    );
  } finally {
    const cleanup = [
      db.recursiveDelete(db.doc(`communities/${communityId}`)).catch(() => undefined),
      db.recursiveDelete(db.doc(`community_topics/${communityId}`)).catch(() => undefined),
      db.recursiveDelete(db.doc(`community_public_topics/${communityId}`)).catch(() => undefined),
    ];

    if (memberUid) {
      cleanup.push(
        adminAuth.deleteUser(memberUid).catch(() => undefined),
        db.doc(`users/${memberUid}`).delete().catch(() => undefined)
      );
    }

    if (moderatorUid) {
      cleanup.push(
        adminAuth.deleteUser(moderatorUid).catch(() => undefined),
        db.doc(`users/${moderatorUid}`).delete().catch(() => undefined)
      );
    }

    if (visitorUid) {
      cleanup.push(
        adminAuth.deleteUser(visitorUid).catch(() => undefined),
        db.doc(`users/${visitorUid}`).delete().catch(() => undefined)
      );
    }

    await Promise.all(cleanup);
    await Promise.all([
      deleteClientApp(memberClient.app),
      deleteClientApp(moderatorClient.app),
      deleteClientApp(visitorClient.app),
      deleteAdminApp(adminApp),
    ]);
  }
}

run().catch((error) => {
  console.error(
    '[community-topics:e2e] Falha no fluxo real de Tópicos/moderação.',
    error
  );
  process.exitCode = 1;
});
