import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

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

function eligibleUserDocument(uid, email, nickname) {
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
    assert.equal(error.code, `functions/${expectedCode}`);
    return error;
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
  const creatorEmail = `community-creator-${runId}@example.test`;
  const incompleteEmail = `community-incomplete-${runId}@example.test`;
  const creatorClient = createClientApp(`community-creator-${runId}`);
  const incompleteClient = createClientApp(`community-incomplete-${runId}`);
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    },
    `community-creation-admin-${runId}`
  );
  const db = getFirestore(adminApp);
  const adminAuth = getAdminAuth(adminApp);

  let creatorUid = '';
  let incompleteUid = '';
  let inviteeUid = '';
  let communityId = '';
  let settingsRequestId = '';
  let feedRequestId = '';
  let feedActionRequestId = '';
  let feedReportId = '';
  let feedCommentRequestId = '';
  let feedCommentActionRequestId = '';
  let feedCommentReportId = '';
  let inviteAuditIds = [];
  const communityNotificationIds = [];

  try {
    const [creatorCredential, incompleteCredential] = await Promise.all([
      createUserWithEmailAndPassword(
        creatorClient.auth,
        creatorEmail,
        `Creator-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        incompleteClient.auth,
        incompleteEmail,
        `Incomplete-${runId}-Aa1!`
      ),
    ]);

    creatorUid = creatorCredential.user.uid;
    incompleteUid = incompleteCredential.user.uid;
    const inviteeEmail = `community-invitee-${runId}@example.test`;
    const inviteeNickname = `Convidado ${shortRunId}`;
    const inviteeNicknameNormalized = inviteeNickname
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const inviteeUser = await adminAuth.createUser({
      email: inviteeEmail,
      emailVerified: true,
    });
    inviteeUid = inviteeUser.uid;

    await Promise.all([
      adminAuth.updateUser(creatorUid, { emailVerified: true }),
      adminAuth.updateUser(incompleteUid, { emailVerified: true }),
    ]);
    await Promise.all([
      creatorCredential.user.getIdToken(true),
      incompleteCredential.user.getIdToken(true),
    ]);

    const creatorDocument = eligibleUserDocument(
      creatorUid,
      creatorEmail,
      `Criador ${shortRunId}`
    );
    const incompleteDocument = {
      ...eligibleUserDocument(
        incompleteUid,
        incompleteEmail,
        `Incompleto ${shortRunId}`
      ),
      profileCompleted: false,
    };
    const entitlementNow = Date.now();

    await Promise.all([
      db.doc(`users/${creatorUid}`).set(creatorDocument),
      db.doc(`entitlements/platform_subscription_${creatorUid}`).set({
        id: `platform_subscription_${creatorUid}`,
        buyerUid: creatorUid,
        scope: 'platform_subscription',
        planKey: 'basic',
        grantedRole: 'basic',
        active: true,
        startsAt: entitlementNow - 60_000,
        endsAt: entitlementNow + 86_400_000,
        updatedAt: entitlementNow,
      }),
      db.doc(`users/${incompleteUid}`).set(incompleteDocument),
      db.doc(`users/${inviteeUid}`).set(eligibleUserDocument(
        inviteeUid,
        inviteeEmail,
        inviteeNickname
      )),
      db.doc(`public_profiles/${inviteeUid}`).set({
        uid: inviteeUid,
        nickname: inviteeNickname,
        nicknameNormalized: inviteeNicknameNormalized,
        avatarUrl: null,
        publicVisibility: 'visible',
        updatedAt: Date.now(),
      }),
      db.doc(`public_index/nickname:${inviteeNicknameNormalized}`).set({
        uid: inviteeUid,
        type: 'nickname',
        value: inviteeNicknameNormalized,
        createdAt: Date.now(),
        lastChangedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ]);

    const createAsCreator = httpsCallable(
      creatorClient.functions,
      'createCommunity'
    );
    const createAsIncomplete = httpsCallable(
      incompleteClient.functions,
      'createCommunity'
    );
    const getCreationCapabilityAsCreator = httpsCallable(
      creatorClient.functions,
      'getCommunityCreationCapability'
    );
    const getCreationCapabilityAsIncomplete = httpsCallable(
      incompleteClient.functions,
      'getCommunityCreationCapability'
    );
    const getTagCatalogAsCreator = httpsCallable(
      creatorClient.functions,
      'getCommunityTagCatalog'
    );
    const getMineAsCreator = httpsCallable(
      creatorClient.functions,
      'getMyCommunitiesPage'
    );
    const getDiscoveryAsCreator = httpsCallable(
      creatorClient.functions,
      'getCommunityDiscoveryPage'
    );
    const getPreviewAsCreator = httpsCallable(
      creatorClient.functions,
      'getCommunityPreview'
    );
    const updateSettingsAsCreator = httpsCallable(
      creatorClient.functions,
      'updateCommunitySettings'
    );
    const createFeedPostAsCreator = httpsCallable(
      creatorClient.functions,
      'createCommunityFeedPost'
    );
    const createFeedPostAsIncomplete = httpsCallable(
      incompleteClient.functions,
      'createCommunityFeedPost'
    );
    const getFeedAsCreator = httpsCallable(
      creatorClient.functions,
      'getCommunityFeedPage'
    );
    const getFeedAsIncomplete = httpsCallable(
      incompleteClient.functions,
      'getCommunityFeedPage'
    );
    const moderateFeedPostAsCreator = httpsCallable(
      creatorClient.functions,
      'moderateCommunityFeedPost'
    );
    const reportFeedPostAsIncomplete = httpsCallable(
      incompleteClient.functions,
      'reportCommunityFeedPost'
    );
    const toggleFeedReactionAsIncomplete = httpsCallable(
      incompleteClient.functions,
      'toggleCommunityFeedReaction'
    );
    const getFeedCommentsAsCreator = httpsCallable(
      creatorClient.functions,
      'getCommunityFeedCommentsPage'
    );
    const getFeedCommentsAsIncomplete = httpsCallable(
      incompleteClient.functions,
      'getCommunityFeedCommentsPage'
    );
    const createFeedCommentAsIncomplete = httpsCallable(
      incompleteClient.functions,
      'createCommunityFeedComment'
    );
    const moderateFeedCommentAsCreator = httpsCallable(
      creatorClient.functions,
      'moderateCommunityFeedComment'
    );
    const reportFeedCommentAsCreator = httpsCallable(
      creatorClient.functions,
      'reportCommunityFeedComment'
    );
    const findInviteCandidateAsCreator = httpsCallable(
      creatorClient.functions,
      'findCommunityInviteCandidate'
    );
    const getSentInvitesAsCreator = httpsCallable(
      creatorClient.functions,
      'getCommunitySentInvites'
    );
    const sendInviteAsCreator = httpsCallable(
      creatorClient.functions,
      'sendCommunityInvite'
    );
    const revokeInviteAsCreator = httpsCallable(
      creatorClient.functions,
      'revokeCommunityInvite'
    );

    const tagCatalog = await getTagCatalogAsCreator({});
    assert.ok(Array.isArray(tagCatalog.data.items));
    assert.ok(tagCatalog.data.items.length > 0);
    const friendshipTag = tagCatalog.data.items.find(
      (tag) => tag.id === 'intent:friendship'
    );
    assert.ok(friendshipTag, 'O catálogo deve expor a tag canônica de amizade.');
    assert.equal(friendshipTag.label, 'Amizade');
    assert.equal(friendshipTag.category, 'intent');
    assert.equal('preferenceKey' in friendshipTag, false);

    const incompleteRequestId = randomUUID();
    await expectCallableFailure(
      createAsIncomplete,
      {
        requestId: incompleteRequestId,
        name: `Comunidade Bloqueada ${shortRunId}`,
        theme: 'interests',
        description: 'Esta criação deve ser bloqueada por perfil incompleto.',
        rules: 'Respeite os participantes e preserve a privacidade de todos.',
        joinPolicy: 'approval',
        accessTier: 'all',
        tagIds: ['intent:friendship'],
      },
      'failed-precondition'
    );

    const blockedCommunityId = `community-${incompleteRequestId}`;
    assert.equal(
      await readData(db.doc(`communities/${blockedCommunityId}`)),
      null,
      'Perfil incompleto não pode deixar Comunidade parcialmente criada.'
    );
    assert.equal(
      await readData(db.doc(`community_creation_requests/${incompleteRequestId}`)),
      null,
      'Falha de elegibilidade não deve consumir a chave idempotente.'
    );

    await db.doc(`users/${incompleteUid}`).update({ profileCompleted: true });
    const freeCapability = await getCreationCapabilityAsIncomplete({});
    assert.equal(freeCapability.data.canCreate, false);
    assert.equal(freeCapability.data.reason, 'subscription_required');
    assert.equal(freeCapability.data.minimumRole, 'basic');
    const freeRequestId = randomUUID();
    await expectCallableFailure(
      createAsIncomplete,
      {
        requestId: freeRequestId,
        name: `Comunidade Free Bloqueada ${shortRunId}`,
        theme: 'interests',
        description: 'Perfil Free pode participar, mas não criar Comunidade.',
        rules: 'Respeite os participantes e preserve a privacidade de todos.',
        joinPolicy: 'approval',
        accessTier: 'all',
        memberLimit: 25,
        tagIds: ['intent:friendship'],
      },
      'permission-denied'
    );

    const requestId = randomUUID();
    const payload = {
      requestId,
      name: `Comunidade Criada ${shortRunId}`,
      theme: 'interests',
      description: 'Comunidade criada integralmente pela callable no Emulator.',
      rules: 'Respeite os participantes.\nNão exponha dados privados de terceiros.',
      joinPolicy: 'approval',
      accessTier: 'premium',
      memberLimit: 25,
      tagIds: [
        'intent:friendship',
        'practice:bdsm',
        'audience:couple_mf',
      ],
    };

    const initialCapability = await getCreationCapabilityAsCreator({});
    assert.equal(initialCapability.data.canCreate, true);
    assert.equal(initialCapability.data.reason, null);
    assert.deepEqual(initialCapability.data.allowedMemberLimits, [25, 50, 100]);

    const firstCreation = await createAsCreator(payload);
    communityId = firstCreation.data.communityId;

    assert.equal(communityId, `community-${requestId}`);
    assert.equal(firstCreation.data.created, true);

    const exhaustedCapability = await getCreationCapabilityAsCreator({});
    assert.equal(exhaustedCapability.data.canCreate, false);
    assert.equal(exhaustedCapability.data.reason, 'limit_reached');

    const repeatedCreation = await createAsCreator(payload);
    assert.equal(repeatedCreation.data.communityId, communityId);
    assert.equal(repeatedCreation.data.created, false);

    const quotaRequestId = randomUUID();
    await expectCallableFailure(
      createAsCreator,
      {
        ...payload,
        requestId: quotaRequestId,
        name: `Segunda Comunidade ${shortRunId}`,
      },
      'resource-exhausted'
    );
    assert.equal(
      await readData(db.doc(`communities/community-${quotaRequestId}`)),
      null,
      'O limite Basic não pode deixar uma segunda Comunidade parcial.'
    );

    const communityRef = db.doc(`communities/${communityId}`);
    const membershipRef = db.doc(
      `communities/${communityId}/members/${creatorUid}`
    );
    const discoveryRef = db.doc(`community_discovery_index/${communityId}`);
    const userIndexRef = db.doc(
      `community_user_index/${creatorUid}/items/${communityId}`
    );
    const requestRef = db.doc(`community_creation_requests/${requestId}`);
    const auditRef = db.doc(
      `community_membership_audit/community-create-${requestId}`
    );

    const [
      community,
      membership,
      discovery,
      userIndex,
      requestRecord,
      audit,
    ] = await Promise.all([
      readData(communityRef),
      readData(membershipRef),
      readData(discoveryRef),
      readData(userIndexRef),
      readData(requestRef),
      readData(auditRef),
    ]);

    assert.ok(community, 'A Comunidade operacional deve existir.');
    assert.equal(community.createdBy, creatorUid);
    assert.equal(community.ownerUid, creatorUid);
    assert.equal(community.source.type, 'community');
    assert.equal(community.source.id, communityId);
    assert.equal(community.status, 'active');
    assert.equal(community.visibility, 'public_preview');
    assert.equal(community.access.join, 'approval');
    assert.equal(community.access.interaction, 'members_only');
    assert.equal(community.access.contentAccess.requiresActiveSubscription, false);
    assert.equal(community.access.contentAccess.minimumRole, null);
    assert.equal(community.metrics.memberCount, 1);
    assert.equal(community.metrics.topicCount, 0);
    assert.equal(community.lifecycle.policyVersion, 1);
    assert.equal(community.lifecycle.archivedAt, null);
    assert.equal(community.lifecycle.scheduledForDeletionAt, null);
    assert.equal(community.lifecycle.retentionHold, false);
    assert.equal(community.moderation.reviewedBy, creatorUid);
    assert.equal(community.rules, payload.rules);
    assert.deepEqual(community.tagIds, payload.tagIds);

    assert.ok(membership, 'O membership do criador deve existir.');
    assert.equal(membership.uid, creatorUid);
    assert.equal(membership.role, 'owner');
    assert.equal(membership.status, 'active');
    assert.equal(membership.requestResolution, 'owner_created');

    assert.ok(discovery, 'A projeção de descoberta deve existir.');
    assert.equal(discovery.communityId, communityId);
    assert.equal(discovery.source.type, 'community');
    assert.equal(discovery.status, 'active');
    assert.equal(discovery.moderationState, 'active');
    assert.equal(discovery.metrics.topicCount, 0);
    assert.deepEqual(discovery.tagIds, payload.tagIds);
    assert.equal('createdBy' in discovery, false);
    assert.equal('rules' in discovery, false);

    assert.ok(userIndex, 'O índice privado do criador deve existir.');
    assert.equal(userIndex.role, 'owner');
    assert.equal(userIndex.status, 'active');

    assert.ok(requestRecord, 'O registro idempotente deve existir.');
    assert.equal(requestRecord.actorUid, creatorUid);
    assert.equal(requestRecord.communityId, communityId);
    assert.equal(requestRecord.status, 'completed');

    assert.ok(audit, 'A auditoria de criação deve existir.');
    assert.equal(audit.action, 'community_created');
    assert.equal(audit.actorUid, creatorUid);
    assert.equal(audit.subjectUid, creatorUid);
    assert.equal(audit.nextRole, 'owner');

    const myCommunities = await getMineAsCreator({
      sourceType: 'community',
      limit: 12,
    });
    const mine = myCommunities.data.items.find(
      (item) => item.communityId === communityId
    );
    assert.ok(mine, 'A Comunidade criada deve aparecer em Minhas Comunidades.');
    assert.equal(mine.name, payload.name);
    assert.equal(mine.source.type, 'community');

    const discoveryPage = await getDiscoveryAsCreator({
      sourceType: 'community',
      limit: 12,
    });
    const discovered = discoveryPage.data.items.find(
      (item) => item.communityId === communityId
    );
    assert.ok(discovered, 'A Comunidade criada deve aparecer em Explorar.');
    assert.equal(discovered.name, payload.name);
    assert.equal('createdBy' in discovered, false);
    assert.equal('rules' in discovered, false);
    assert.equal('lifecycleStatus' in discovered, false);

    const preview = await getPreviewAsCreator({ communityId });
    assert.equal(preview.data.community.communityId, communityId);
    assert.equal(preview.data.rules, payload.rules);
    assert.equal(preview.data.lifecycleStatus, 'active');
    assert.equal(preview.data.viewerRole, 'owner');
    assert.equal(preview.data.viewerMode, 'manager');
    assert.equal(preview.data.canInteract, true);
    assert.equal(preview.data.canInviteCommunityMembers, true);
    assert.equal(preview.data.canManageCommunitySettings, true);
    assert.equal(preview.data.settings.name, payload.name);
    assert.deepEqual(preview.data.settings.tagIds, payload.tagIds);
    assert.deepEqual(preview.data.capacity, {
      configuredLimit: 25,
      effectiveLimit: 25,
      memberCount: 1,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: false,
      allowedMemberLimits: [25, 50, 100],
    });

    await expectCallableFailure(
      createFeedPostAsIncomplete,
      {
        requestId: randomUUID(),
        communityId,
        text: 'Visitante não pode publicar no Mural.',
        audience: 'members_only',
      },
      'permission-denied'
    );

    feedRequestId = randomUUID();
    const feedPayload = {
      requestId: feedRequestId,
      communityId,
      text: 'Primeira publicação operacional do Mural.',
      audience: 'public_preview',
    };
    const feedWrite = await createFeedPostAsCreator(feedPayload);
    assert.equal(feedWrite.data.postId, feedRequestId);
    assert.equal(feedWrite.data.created, true);
    assert.equal(feedWrite.data.deduplicated, false);

    const repeatedFeedWrite = await createFeedPostAsCreator(feedPayload);
    assert.equal(repeatedFeedWrite.data.postId, feedRequestId);
    assert.equal(repeatedFeedWrite.data.created, false);
    assert.equal(repeatedFeedWrite.data.deduplicated, true);

    const [feedPost, feedProjection, feedRequest, feedAudit] =
      await Promise.all([
        readData(db.doc(
          `community_feed_posts/${communityId}/items/${feedRequestId}`
        )),
        readData(db.doc(
          `community_public_feed/${communityId}/items/${feedRequestId}`
        )),
        readData(db.doc(`community_feed_requests/${feedRequestId}`)),
        readData(db.doc(`community_feed_audit/post-${feedRequestId}`)),
      ]);

    assert.equal(feedPost.actorUid, creatorUid);
    assert.equal(feedPost.text, feedPayload.text);
    assert.equal(feedProjection.audience, 'public_preview');
    assert.equal('actorUid' in feedProjection, false);
    assert.equal(feedRequest.actorUid, creatorUid);
    assert.equal(feedAudit.action, 'community-feed-post-created');
    assert.equal('text' in feedAudit, false);

    const feedPage = await getFeedAsCreator({
      communityId,
      view: 'feed',
      limit: 10,
    });
    assert.equal(feedPage.data.items[0].postId, feedRequestId);
    assert.equal(feedPage.data.items[0].text, feedPayload.text);
    assert.equal('actorUid' in feedPage.data.items[0].author, false);
    assert.deepEqual(feedPage.data.items[0].capabilities, {
      canDeleteOwn: true,
      canModerate: false,
      canReport: false,
      canReact: false,
      viewerReacted: false,
      canViewComments: true,
      canComment: true,
    });

    const communityAfterFeed = await readData(communityRef);
    const discoveryAfterFeed = await readData(discoveryRef);
    assert.equal(communityAfterFeed.metrics.postCount, 1);
    assert.equal(discoveryAfterFeed.metrics.postCount, 1);

    const incompleteMembershipRef = db.doc(
      `communities/${communityId}/members/${incompleteUid}`
    );
    await incompleteMembershipRef.set({
      uid: incompleteUid,
      status: 'active',
      role: 'member',
      joinedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const feedBeforeReaction = await getFeedAsIncomplete({
      communityId,
      view: 'feed',
      limit: 10,
    });
    assert.equal(feedBeforeReaction.data.items[0].capabilities.canReact, true);
    assert.equal(
      feedBeforeReaction.data.items[0].capabilities.canViewComments,
      true
    );
    assert.equal(feedBeforeReaction.data.items[0].capabilities.canComment, true);
    assert.equal(
      feedBeforeReaction.data.items[0].capabilities.viewerReacted,
      false
    );

    const addedReaction = await toggleFeedReactionAsIncomplete({
      communityId,
      postId: feedRequestId,
    });
    assert.equal(addedReaction.data.reacted, true);
    assert.equal(addedReaction.data.reactionCount, 1);
    const feedAfterReaction = await getFeedAsIncomplete({
      communityId,
      view: 'feed',
      limit: 10,
    });
    assert.equal(feedAfterReaction.data.items[0].metrics.reactionCount, 1);
    assert.equal(
      feedAfterReaction.data.items[0].capabilities.viewerReacted,
      true
    );
    assert.equal(
      (await readData(db.doc(
        `community_feed_user_reactions/${incompleteUid}/items/${communityId}:${feedRequestId}`
      ))).actorUid,
      incompleteUid
    );

    const removedReaction = await toggleFeedReactionAsIncomplete({
      communityId,
      postId: feedRequestId,
    });
    assert.equal(removedReaction.data.reacted, false);
    assert.equal(removedReaction.data.reactionCount, 0);

    feedCommentRequestId = randomUUID();
    const createdComment = await createFeedCommentAsIncomplete({
      requestId: feedCommentRequestId,
      communityId,
      postId: feedRequestId,
      text: 'Comentário operacional e privado em relação ao UID.',
    });
    assert.equal(createdComment.data.commentId, feedCommentRequestId);
    assert.equal(createdComment.data.commentCount, 1);
    assert.equal(createdComment.data.created, true);
    const repeatedComment = await createFeedCommentAsIncomplete({
      requestId: feedCommentRequestId,
      communityId,
      postId: feedRequestId,
      text: 'Comentário operacional e privado em relação ao UID.',
    });
    assert.equal(repeatedComment.data.deduplicated, true);
    const creatorNotificationsSnapshot = await db
      .collection('notifications')
      .where('userId', '==', creatorUid)
      .get();
    const commentNotifications = creatorNotificationsSnapshot.docs.filter(
      (document) => {
        const notification = document.data();
        return notification.type === 'community.comment.received'
          && notification.communityId === communityId
          && notification.postId === feedRequestId;
      }
    );
    assert.equal(commentNotifications.length, 1);
    assert.equal(commentNotifications[0].data().activityCount, 1);
    assert.equal(commentNotifications[0].data().actorUid, incompleteUid);
    assert.equal(
      commentNotifications[0].data().route,
      `/dashboard/comunidades/${communityId}`
    );
    communityNotificationIds.push(commentNotifications[0].id);

    await incompleteMembershipRef.delete();
    await expectCallableFailure(
      createFeedCommentAsIncomplete,
      {
        requestId: randomUUID(),
        communityId,
        postId: feedRequestId,
        text: 'Visitante não pode criar outro comentário.',
      },
      'permission-denied'
    );

    const publicComments = await getFeedCommentsAsIncomplete({
      communityId,
      postId: feedRequestId,
      limit: 12,
    });
    assert.equal(publicComments.data.items.length, 1);
    assert.equal(publicComments.data.items[0].commentId, feedCommentRequestId);
    assert.equal(publicComments.data.items[0].capabilities.canDeleteOwn, true);
    assert.equal(publicComments.data.items[0].capabilities.canModerate, false);
    assert.equal('actorUid' in publicComments.data.items[0], false);

    const managedComments = await getFeedCommentsAsCreator({
      communityId,
      postId: feedRequestId,
      limit: 12,
    });
    assert.equal(managedComments.data.items[0].capabilities.canModerate, true);
    assert.equal(managedComments.data.items[0].capabilities.canReport, true);

    const commentReport = await reportFeedCommentAsCreator({
      communityId,
      postId: feedRequestId,
      commentId: feedCommentRequestId,
      reason: 'harassment',
      details: 'Comentário encaminhado para análise administrativa.',
      route: `/comunidades/${communityId}`,
    });
    feedCommentReportId = commentReport.data.reportId;
    const commentReportDocument = await readData(
      db.doc(`moderation_reports/${feedCommentReportId}`)
    );
    assert.equal(commentReportDocument.targetType, 'community_feed_comment');
    assert.equal(commentReportDocument.targetId, feedCommentRequestId);
    assert.equal(commentReportDocument.parentTargetId, feedRequestId);
    assert.equal(commentReportDocument.containerTargetId, communityId);
    assert.equal(commentReportDocument.targetAuthorUid, incompleteUid);

    feedCommentActionRequestId = randomUUID();
    const removedComment = await moderateFeedCommentAsCreator({
      requestId: feedCommentActionRequestId,
      communityId,
      postId: feedRequestId,
      commentId: feedCommentRequestId,
      action: 'remove',
      reason: 'Viola as regras da Comunidade.',
    });
    assert.equal(removedComment.data.status, 'removed');
    assert.equal(removedComment.data.commentCount, 0);
    assert.equal(removedComment.data.deduplicated, false);
    const repeatedCommentRemoval = await moderateFeedCommentAsCreator({
      requestId: feedCommentActionRequestId,
      communityId,
      postId: feedRequestId,
      commentId: feedCommentRequestId,
      action: 'remove',
      reason: 'Viola as regras da Comunidade.',
    });
    assert.equal(repeatedCommentRemoval.data.deduplicated, true);
    const incompleteNotificationsSnapshot = await db
      .collection('notifications')
      .where('userId', '==', incompleteUid)
      .get();
    const moderationNotifications = incompleteNotificationsSnapshot.docs.filter(
      (document) => {
        const notification = document.data();
        return notification.type === 'community.content.moderated'
          && notification.communityId === communityId
          && notification.postId === feedRequestId
          && notification.commentId === feedCommentRequestId;
      }
    );
    assert.equal(moderationNotifications.length, 1);
    assert.equal(moderationNotifications[0].data().moderationTarget, 'comment');
    assert.equal(moderationNotifications[0].data().actorUid, creatorUid);
    assert.equal(
      moderationNotifications[0].data().body.includes('Viola as regras'),
      false
    );
    communityNotificationIds.push(moderationNotifications[0].id);
    assert.equal(
      (await getFeedCommentsAsCreator({
        communityId,
        postId: feedRequestId,
        limit: 12,
      })).data.items.length,
      0
    );

    const reportWrite = await reportFeedPostAsIncomplete({
      communityId,
      postId: feedRequestId,
      reason: 'harassment',
      details: 'Publicação encaminhada para validação da fila administrativa.',
      route: `/comunidades/${communityId}`,
    });
    feedReportId = reportWrite.data.reportId;
    const feedReport = await readData(
      db.doc(`moderation_reports/${feedReportId}`)
    );
    assert.equal(feedReport.targetType, 'community_feed_post');
    assert.equal(feedReport.targetAuthorUid, creatorUid);
    assert.equal(feedReport.parentTargetId, communityId);
    await expectCallableFailure(
      reportFeedPostAsIncomplete,
      {
        communityId,
        postId: feedRequestId,
        reason: 'harassment',
      },
      'already-exists'
    );

    feedActionRequestId = randomUUID();
    const deletedFeedPost = await moderateFeedPostAsCreator({
      requestId: feedActionRequestId,
      communityId,
      postId: feedRequestId,
      action: 'delete_own',
    });
    assert.equal(deletedFeedPost.data.status, 'deleted');
    assert.equal(deletedFeedPost.data.deduplicated, false);
    const repeatedFeedDeletion = await moderateFeedPostAsCreator({
      requestId: feedActionRequestId,
      communityId,
      postId: feedRequestId,
      action: 'delete_own',
    });
    assert.equal(repeatedFeedDeletion.data.deduplicated, true);

    const [deletedPost, deletedProjection, actionAudit] = await Promise.all([
      readData(db.doc(
        `community_feed_posts/${communityId}/items/${feedRequestId}`
      )),
      readData(db.doc(
        `community_public_feed/${communityId}/items/${feedRequestId}`
      )),
      readData(db.doc(`community_feed_audit/action-${feedActionRequestId}`)),
    ]);
    assert.equal(deletedPost.status, 'deleted');
    assert.equal(deletedProjection, null);
    assert.equal(actionAudit.action, 'community-feed-post-deleted-by-author');
    assert.equal('text' in actionAudit, false);
    assert.equal((await readData(communityRef)).metrics.postCount, 0);
    assert.equal((await readData(discoveryRef)).metrics.postCount, 0);

    settingsRequestId = randomUUID();
    const settingsPayload = {
      requestId: settingsRequestId,
      communityId,
      name: `Comunidade Editada ${shortRunId}`,
      description: 'Descrição atualizada pela gestão da Comunidade.',
      rules: 'Respeite todos.\nConvites não autorizam exposição de terceiros.',
      joinPolicy: 'invite_only',
      accessTier: 'all',
      membersCanInvite: true,
      memberLimit: 25,
      tagIds: ['intent:friendship', 'practice:bdsm'],
    };
    const settingsUpdate = await updateSettingsAsCreator(settingsPayload);
    assert.equal(settingsUpdate.data.communityId, communityId);
    assert.equal(settingsUpdate.data.updated, true);
    assert.ok(settingsUpdate.data.changedFields.includes('name'));
    assert.ok(settingsUpdate.data.changedFields.includes('rules'));
    assert.ok(settingsUpdate.data.changedFields.includes('joinPolicy'));

    const repeatedSettingsUpdate = await updateSettingsAsCreator(
      settingsPayload
    );
    assert.equal(repeatedSettingsUpdate.data.communityId, communityId);
    assert.equal(repeatedSettingsUpdate.data.updated, false);
    assert.deepEqual(
      repeatedSettingsUpdate.data.changedFields,
      settingsUpdate.data.changedFields
    );

    const [
      updatedCommunity,
      updatedDiscovery,
      settingsRequest,
      settingsAudit,
    ] = await Promise.all([
      readData(communityRef),
      readData(discoveryRef),
      readData(db.doc(`community_settings_requests/${settingsRequestId}`)),
      readData(db.doc(`community_settings_audit/settings-${settingsRequestId}`)),
    ]);

    assert.equal(updatedCommunity.name, settingsPayload.name);
    assert.equal(updatedCommunity.rules, settingsPayload.rules);
    assert.equal(updatedCommunity.access.join, 'invite_only');
    assert.equal(updatedCommunity.access.invites.membersCanInvite, true);
    assert.equal(
      updatedCommunity.lifecycle.lastMeaningfulActivityAt,
      community.lifecycle.lastMeaningfulActivityAt,
      'Edição editorial não deve simular atividade significativa.'
    );

    assert.equal(updatedDiscovery.name, settingsPayload.name);
    assert.equal(updatedDiscovery.access.join, 'invite_only');
    assert.equal(updatedDiscovery.rankScore, discovery.rankScore);
    assert.equal('rules' in updatedDiscovery, false);
    assert.equal('invites' in updatedDiscovery.access, false);

    assert.equal(settingsRequest.actorUid, creatorUid);
    assert.equal(settingsRequest.communityId, communityId);
    assert.equal(settingsRequest.status, 'completed');
    assert.equal(settingsAudit.action, 'community_settings_updated');
    assert.equal(settingsAudit.actorUid, creatorUid);
    assert.equal('rules' in settingsAudit, false);

    const updatedPreview = await getPreviewAsCreator({ communityId });
    assert.equal(updatedPreview.data.rules, settingsPayload.rules);
    assert.equal(updatedPreview.data.canManageCommunitySettings, true);
    assert.deepEqual(updatedPreview.data.settings, {
      name: settingsPayload.name,
      description: settingsPayload.description,
      rules: settingsPayload.rules,
      joinPolicy: settingsPayload.joinPolicy,
      membersCanInvite: settingsPayload.membersCanInvite,
      memberLimit: settingsPayload.memberLimit,
      tagIds: settingsPayload.tagIds,
    });

    const updatedDiscoveryPage = await getDiscoveryAsCreator({
      sourceType: 'community',
      limit: 12,
    });
    const updatedDiscovered = updatedDiscoveryPage.data.items.find(
      (item) => item.communityId === communityId
    );
    assert.ok(updatedDiscovered, 'A Comunidade editada deve seguir em Explorar.');
    assert.equal(updatedDiscovered.name, settingsPayload.name);
    assert.equal(updatedDiscovered.access.join, 'invite_only');
    assert.equal('rules' in updatedDiscovered, false);
    assert.equal('settings' in updatedDiscovered, false);
    assert.equal('lifecycleStatus' in updatedDiscovered, false);

    const candidateBeforeInvite = await findInviteCandidateAsCreator({
      communityId,
      nickname: inviteeNickname,
    });
    assert.equal(candidateBeforeInvite.data.candidate.userId, inviteeUid);
    assert.equal(candidateBeforeInvite.data.candidate.nickname, inviteeNickname);
    assert.equal(candidateBeforeInvite.data.candidate.status, 'eligible');

    const missingCandidate = await findInviteCandidateAsCreator({
      communityId,
      nickname: `Inexistente ${shortRunId}`,
    });
    assert.equal(missingCandidate.data.candidate, null);

    const sentBeforeInvite = await getSentInvitesAsCreator({ communityId });
    assert.deepEqual(sentBeforeInvite.data.items, []);

    const sentInvite = await sendInviteAsCreator({
      communityId,
      receiverId: inviteeUid,
    });
    const communityInviteId = sentInvite.data.inviteId;
    assert.equal(sentInvite.data.status, 'pending');
    assert.equal(sentInvite.data.deduplicated, false);

    const candidateAfterInvite = await findInviteCandidateAsCreator({
      communityId,
      nickname: inviteeNickname,
    });
    assert.equal(candidateAfterInvite.data.candidate.status, 'invite_pending');

    const sentAfterInvite = await getSentInvitesAsCreator({ communityId });
    assert.equal(sentAfterInvite.data.items.length, 1);
    assert.equal(sentAfterInvite.data.items[0].inviteId, communityInviteId);
    assert.equal(sentAfterInvite.data.items[0].receiverId, inviteeUid);
    assert.equal(sentAfterInvite.data.items[0].receiverLabel, inviteeNickname);

    const revokedInvite = await revokeInviteAsCreator({
      inviteId: communityInviteId,
    });
    assert.equal(revokedInvite.data.status, 'revoked');

    const sentAfterRevoke = await getSentInvitesAsCreator({ communityId });
    assert.deepEqual(sentAfterRevoke.data.items, []);

    const inviteAudits = await db
      .collection('community_membership_audit')
      .where('communityId', '==', communityId)
      .get();
    inviteAuditIds = inviteAudits.docs
      .filter((document) => String(document.get('action')).startsWith(
        'community-invite-'
      ))
      .map((document) => document.id);

    console.log(
      '[community-creation:e2e] Criação direta de Comunidade validada com sucesso.'
    );
  } finally {
    const cleanup = [];

    if (communityId && creatorUid) {
      const requestId = communityId.slice('community-'.length);
      cleanup.push(
        db.doc(`communities/${communityId}/members/${creatorUid}`).delete(),
        db.doc(`community_discovery_index/${communityId}`).delete(),
        db.doc(`community_user_index/${creatorUid}/items/${communityId}`).delete(),
        db.doc(`community_creation_requests/${requestId}`).delete(),
        db.doc(`community_membership_audit/community-create-${requestId}`).delete(),
        db.doc(`communities/${communityId}`).delete()
      );
    }

    if (settingsRequestId) {
      cleanup.push(
        db.doc(`community_settings_requests/${settingsRequestId}`).delete(),
        db.doc(
          `community_settings_audit/settings-${settingsRequestId}`
        ).delete()
      );
    }

    if (communityId && feedRequestId) {
      cleanup.push(
        db.doc(
          `community_feed_posts/${communityId}/items/${feedRequestId}`
        ).delete(),
        db.doc(
          `community_public_feed/${communityId}/items/${feedRequestId}`
        ).delete(),
        db.doc(`community_feed_requests/${feedRequestId}`).delete(),
        db.doc(`community_feed_audit/post-${feedRequestId}`).delete(),
        db.doc(`community_feed_user_state/${creatorUid}`).delete(),
        db.doc(
          `community_feed_user_posts/${creatorUid}/items/${communityId}:${feedRequestId}`
        ).delete()
      );
    }

    if (feedActionRequestId) {
      cleanup.push(
        db.doc(`community_feed_requests/${feedActionRequestId}`).delete(),
        db.doc(`community_feed_audit/action-${feedActionRequestId}`).delete(),
        db.doc(
          `community_feed_user_actions/${creatorUid}/items/${communityId}:${feedRequestId}`
        ).delete()
      );
    }

    if (feedReportId) {
      cleanup.push(db.doc(`moderation_reports/${feedReportId}`).delete());
    }

    if (communityId && feedRequestId && feedCommentRequestId) {
      cleanup.push(
        db.doc(
          `community_feed_posts/${communityId}/items/${feedRequestId}/comments/${feedCommentRequestId}`
        ).delete(),
        db.doc(`community_feed_requests/${feedCommentRequestId}`).delete(),
        db.doc(`community_feed_audit/comment-${feedCommentRequestId}`).delete(),
        db.doc(
          `community_feed_user_comments/${incompleteUid}/items/${communityId}:${feedRequestId}:${feedCommentRequestId}`
        ).delete()
      );
    }

    if (feedCommentActionRequestId) {
      cleanup.push(
        db.doc(`community_feed_requests/${feedCommentActionRequestId}`).delete(),
        db.doc(
          `community_feed_audit/comment-action-${feedCommentActionRequestId}`
        ).delete()
      );
    }

    if (feedCommentReportId) {
      cleanup.push(db.doc(`moderation_reports/${feedCommentReportId}`).delete());
    }

    for (const notificationId of communityNotificationIds) {
      cleanup.push(db.doc(`notifications/${notificationId}`).delete());
    }

    if (incompleteUid) {
      const reportRateLimitId = createHash('sha256')
        .update(`reportCommunityFeedPost:${incompleteUid}`)
        .digest('hex');
      const reactionRateLimitId = createHash('sha256')
        .update(`toggleCommunityFeedReaction:${incompleteUid}`)
        .digest('hex');
      const commentRateLimitId = createHash('sha256')
        .update(`createCommunityFeedComment:${incompleteUid}`)
        .digest('hex');
      cleanup.push(
        db.doc(
          `backend_rate_limits/backend-rate-limit__${reportRateLimitId}`
        ).delete(),
        db.doc(
          `backend_rate_limits/backend-rate-limit__${reactionRateLimitId}`
        ).delete(),
        db.doc(
          `backend_rate_limits/backend-rate-limit__${commentRateLimitId}`
        ).delete()
      );
    }

    if (creatorUid) {
      const commentReportRateLimitId = createHash('sha256')
        .update(`reportCommunityFeedComment:${creatorUid}`)
        .digest('hex');
      cleanup.push(
        db.doc(
          `backend_rate_limits/backend-rate-limit__${commentReportRateLimitId}`
        ).delete()
      );
    }

    if (communityId && incompleteUid && feedRequestId) {
      cleanup.push(
        db.doc(`communities/${communityId}/members/${incompleteUid}`).delete(),
        db.doc(
          `community_feed_posts/${communityId}/items/${feedRequestId}/reactions/${incompleteUid}`
        ).delete(),
        db.doc(
          `community_feed_user_reactions/${incompleteUid}/items/${communityId}:${feedRequestId}`
        ).delete()
      );
    }

    if (communityId && inviteeUid) {
      cleanup.push(
        db.doc(`invites/community:${communityId}:to:${inviteeUid}`).delete(),
        db.doc(
          `notifications/community_invite_received_${communityId}_${inviteeUid}`
        ).delete()
      );
    }

    for (const auditId of inviteAuditIds) {
      cleanup.push(db.doc(`community_membership_audit/${auditId}`).delete());
    }

    if (creatorUid) {
      cleanup.push(
        db.doc(`entitlements/platform_subscription_${creatorUid}`).delete(),
        db.doc(`users/${creatorUid}`).delete()
      );
    }
    if (incompleteUid) {
      cleanup.push(db.doc(`users/${incompleteUid}`).delete());
    }
    if (inviteeUid) {
      const inviteeIndexSnapshot = await db
        .collection('public_index')
        .where('uid', '==', inviteeUid)
        .get()
        .catch(() => null);
      for (const document of inviteeIndexSnapshot?.docs ?? []) {
        cleanup.push(document.ref.delete());
      }
      cleanup.push(
        db.doc(`public_profiles/${inviteeUid}`).delete(),
        db.doc(`users/${inviteeUid}`).delete()
      );
    }

    await Promise.allSettled(cleanup);

    if (creatorUid) {
      await adminAuth.deleteUser(creatorUid).catch(() => undefined);
    }
    if (incompleteUid) {
      await adminAuth.deleteUser(incompleteUid).catch(() => undefined);
    }
    if (inviteeUid) {
      await adminAuth.deleteUser(inviteeUid).catch(() => undefined);
    }

    await Promise.allSettled([
      deleteClientApp(creatorClient.app),
      deleteClientApp(incompleteClient.app),
      deleteAdminApp(adminApp),
    ]);
  }
}

run().catch((error) => {
  console.error('[community-creation:e2e] Falha:', error);
  process.exitCode = 1;
});
