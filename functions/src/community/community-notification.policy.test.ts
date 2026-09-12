import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allowsCommunityActivityNotifications,
  buildCommunityCommentNotificationCopy,
  buildCommunityCommentNotificationId,
  buildCommunityModerationNotificationCopy,
  buildCommunityModerationNotificationId,
  buildCommunityNotificationRoute,
  buildCommunityReplyNotificationCopy,
  buildCommunityReplyNotificationId,
  canReceiveCommunityActivityNotification,
  canReceiveCommunityEssentialNotification,
  isCommunityNotificationInCurrentMembershipCycle,
  isCommunitySocialActivityNotificationType,
} from './community-notification.policy';

const ACTIVE_USER = {
  uid: 'author-1',
  accountStatus: 'active',
  profileCompleted: true,
  loginAllowed: true,
};

const ACTIVE_MEMBERSHIP = {
  status: 'active',
  joinedAt: { seconds: 1_800_000_000, nanoseconds: 0 },
};

test('persistência in-app independe da preferência global de push', () => {
  assert.equal(allowsCommunityActivityNotifications(undefined), true);
  assert.equal(allowsCommunityActivityNotifications({
    notificationPreferences: { communities: false },
  }), true);
});

test('atividade exige destinatário operacional, membership ativo e nunca notifica o próprio autor', () => {
  assert.equal(canReceiveCommunityActivityNotification(
    ACTIVE_USER,
    'author-1',
    'commenter-1',
    ACTIVE_MEMBERSHIP
  ), true);
  assert.equal(canReceiveCommunityActivityNotification(
    ACTIVE_USER,
    'author-1',
    'author-1',
    ACTIVE_MEMBERSHIP
  ), false);
  assert.equal(canReceiveCommunityActivityNotification(
    { ...ACTIVE_USER, accountStatus: 'self_suspended' },
    'author-1',
    'commenter-1',
    ACTIVE_MEMBERSHIP
  ), false);

  for (const membership of [
    undefined,
    { status: 'pending' },
    { status: 'left' },
    { status: 'removed' },
    { status: 'blocked' },
  ]) {
    assert.equal(canReceiveCommunityActivityNotification(
      ACTIVE_USER,
      'author-1',
      'commenter-1',
      membership
    ), false);
  }
});

test('aviso essencial alcança conta suspensa sem depender de membership, mas não conta excluída', () => {
  assert.equal(canReceiveCommunityEssentialNotification(
    { ...ACTIVE_USER, accountStatus: 'self_suspended' },
    'author-1',
    'moderator-1'
  ), true);
  assert.equal(canReceiveCommunityEssentialNotification(
    { ...ACTIVE_USER, accountStatus: 'deleted', loginAllowed: false },
    'author-1',
    'moderator-1'
  ), false);
});

test('classifica apenas atividade social comum para o gate de membership', () => {
  assert.equal(isCommunitySocialActivityNotificationType('community.comment.received'), true);
  assert.equal(isCommunitySocialActivityNotificationType('community.comment.reply.received'), true);
  assert.equal(isCommunitySocialActivityNotificationType('community.content.moderated'), false);
  assert.equal(isCommunitySocialActivityNotificationType('security.account.changed'), false);
});

test('atividade social pertence somente ao ciclo atual da participação', () => {
  assert.equal(isCommunityNotificationInCurrentMembershipCycle(
    ACTIVE_MEMBERSHIP,
    { seconds: 1_800_000_001, nanoseconds: 0 }
  ), true);
  assert.equal(isCommunityNotificationInCurrentMembershipCycle(
    ACTIVE_MEMBERSHIP,
    { seconds: 1_799_999_999, nanoseconds: 999_000_000 }
  ), false);
  assert.equal(isCommunityNotificationInCurrentMembershipCycle(
    { status: 'left', joinedAt: ACTIVE_MEMBERSHIP.joinedAt },
    { seconds: 1_800_000_001, nanoseconds: 0 }
  ), false);
  assert.equal(isCommunityNotificationInCurrentMembershipCycle(
    { status: 'active' },
    { seconds: 1_800_000_001, nanoseconds: 0 }
  ), false);
});

test('agrupa mensagens da mesma publicação na mesma janela e separa ciclos de membership', () => {
  const first = buildCommunityCommentNotificationId(
    'community-1',
    'post-1',
    'author-1',
    1_800_000_000_000,
    1_799_000_000_000
  );
  const sameWindow = buildCommunityCommentNotificationId(
    'community-1',
    'post-1',
    'author-1',
    1_800_000_000_000 + 60_000,
    1_799_000_000_000
  );
  const rejoined = buildCommunityCommentNotificationId(
    'community-1',
    'post-1',
    'author-1',
    1_800_000_000_000 + 60_000,
    1_800_000_030_000
  );
  const nextWindow = buildCommunityCommentNotificationId(
    'community-1',
    'post-1',
    'author-1',
    1_800_000_000_000 + 24 * 60 * 60 * 1_000,
    1_799_000_000_000
  );

  assert.equal(first, sameWindow);
  assert.notEqual(first, rejoined);
  assert.notEqual(first, nextWindow);
  assert.match(first, /^community_comments_[a-f0-9]{40}$/);
});

test('agrupa respostas pela mensagem citada e separa ciclos de membership', () => {
  const first = buildCommunityReplyNotificationId(
    'community-1',
    'post-1',
    'comment-1',
    'author-1',
    1_800_000_000_000,
    1_799_000_000_000
  );
  const sameReference = buildCommunityReplyNotificationId(
    'community-1',
    'post-1',
    'comment-1',
    'author-1',
    1_800_000_000_000 + 60_000,
    1_799_000_000_000
  );
  const rejoined = buildCommunityReplyNotificationId(
    'community-1',
    'post-1',
    'comment-1',
    'author-1',
    1_800_000_000_000 + 60_000,
    1_800_000_030_000
  );
  const otherReference = buildCommunityReplyNotificationId(
    'community-1',
    'post-1',
    'comment-2',
    'author-1',
    1_800_000_000_000 + 60_000,
    1_799_000_000_000
  );

  assert.equal(first, sameReference);
  assert.notEqual(first, rejoined);
  assert.notEqual(first, otherReference);
  assert.match(first, /^community_replies_[a-f0-9]{40}$/);
});

test('resume atividade da conversa sem copiar conteúdo', () => {
  assert.deepEqual(buildCommunityCommentNotificationCopy({
    existingActivityCount: 0,
    actorLabel: ' Pessoa\nSegura ',
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Nova mensagem na conversa',
    body: 'Pessoa Segura entrou na conversa da sua publicação em Comunidade Teste.',
    activityCount: 1,
  });
  assert.deepEqual(buildCommunityCommentNotificationCopy({
    existingActivityCount: 2,
    actorLabel: 'Outra pessoa',
    communityName: 'Comunidade Teste',
  }), {
    title: '3 novas mensagens',
    body: 'A conversa da sua publicação em Comunidade Teste recebeu 3 novas mensagens.',
    activityCount: 3,
  });
});

test('resume respostas como referência a mensagem sem copiar o texto respondido', () => {
  assert.deepEqual(buildCommunityReplyNotificationCopy({
    existingActivityCount: 0,
    actorLabel: ' Pessoa\nSegura ',
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Nova resposta',
    body: 'Pessoa Segura respondeu à sua mensagem em Comunidade Teste.',
    activityCount: 1,
  });
  assert.deepEqual(buildCommunityReplyNotificationCopy({
    existingActivityCount: 2,
    actorLabel: 'Outra pessoa',
    communityName: 'Comunidade Teste',
  }), {
    title: '3 novas respostas',
    body: 'Sua mensagem em Comunidade Teste recebeu 3 novas respostas.',
    activityCount: 3,
  });
});

test('gera aviso essencial determinístico sem expor o motivo da remoção', () => {
  const notificationId = buildCommunityModerationNotificationId(
    'comment',
    'request-1',
    'author-1'
  );
  const copy = buildCommunityModerationNotificationCopy({
    target: 'comment',
    communityName: 'Comunidade Teste',
  });
  const legacyReplyCopy = buildCommunityModerationNotificationCopy({
    target: 'reply',
    communityName: 'Comunidade Teste',
  });

  assert.match(notificationId, /^community_moderation_[a-f0-9]{40}$/);
  assert.equal(copy.title, 'Conteúdo moderado');
  assert.equal(copy.body.includes('motivo privado'), false);
  assert.equal(copy.body.includes('mensagem'), true);
  assert.equal(legacyReplyCopy.body.includes('resposta legada'), true);
  assert.equal(buildCommunityNotificationRoute('community:1'),
    '/dashboard/comunidades/community%3A1');
});