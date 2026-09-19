import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allowsCommunityActivityNotifications,
  buildCommunityCommentNotificationCopy,
  buildCommunityCommentNotificationId,
  buildCommunityMembershipReviewNotificationCopy,
  buildCommunityMembershipReviewNotificationId,
  buildCommunityModerationNotificationCopy,
  buildCommunityModerationNotificationId,
  buildCommunityPostReplyNotificationCopy,
  buildCommunityPostReplyNotificationId,
  buildCommunityNotificationRoute,
  buildCommunityReplyNotificationCopy,
  buildCommunityReplyNotificationId,
  canReceiveCommunityActivityNotification,
  canReceiveCommunityEssentialNotification,
} from './community-notification.policy';

const ACTIVE_USER = {
  uid: 'author-1',
  accountStatus: 'active',
  profileCompleted: true,
  loginAllowed: true,
};
const MEMBERSHIP_CYCLE = 1_799_999_000_000;

test('persistência in-app independe da preferência global de push', () => {
  assert.equal(allowsCommunityActivityNotifications(undefined), true);
  assert.equal(allowsCommunityActivityNotifications({
    notificationPreferences: { communities: false },
  }), true);
});

test('atividade exige destinatário operacional e nunca notifica o próprio autor', () => {
  assert.equal(canReceiveCommunityActivityNotification(
    ACTIVE_USER,
    'author-1',
    'commenter-1'
  ), true);
  assert.equal(canReceiveCommunityActivityNotification(
    ACTIVE_USER,
    'author-1',
    'author-1'
  ), false);
  assert.equal(canReceiveCommunityActivityNotification(
    { ...ACTIVE_USER, accountStatus: 'self_suspended' },
    'author-1',
    'commenter-1'
  ), false);
});

test('aviso essencial alcança conta suspensa, mas não conta excluída', () => {
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

test('agrupa mensagens somente dentro do mesmo ciclo e janela diária', () => {
  const first = buildCommunityCommentNotificationId(
    'community-1',
    'post-1',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000
  );
  const sameWindow = buildCommunityCommentNotificationId(
    'community-1',
    'post-1',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000 + 60_000
  );
  const nextCycle = buildCommunityCommentNotificationId(
    'community-1',
    'post-1',
    'author-1',
    MEMBERSHIP_CYCLE + 1,
    1_800_000_000_000 + 60_000
  );
  const nextWindow = buildCommunityCommentNotificationId(
    'community-1',
    'post-1',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000 + 24 * 60 * 60 * 1_000
  );

  assert.equal(first, sameWindow);
  assert.notEqual(first, nextCycle);
  assert.notEqual(first, nextWindow);
  assert.match(first, /^community_comments_[a-f0-9]{40}$/);
});

test('agrupa respostas somente pela mesma mensagem, ciclo e janela diária', () => {
  const first = buildCommunityReplyNotificationId(
    'community-1',
    'post-1',
    'comment-1',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000
  );
  const sameReference = buildCommunityReplyNotificationId(
    'community-1',
    'post-1',
    'comment-1',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000 + 60_000
  );
  const otherReference = buildCommunityReplyNotificationId(
    'community-1',
    'post-1',
    'comment-2',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000 + 60_000
  );
  const nextCycle = buildCommunityReplyNotificationId(
    'community-1',
    'post-1',
    'comment-1',
    'author-1',
    MEMBERSHIP_CYCLE + 1,
    1_800_000_000_000 + 60_000
  );

  assert.equal(first, sameReference);
  assert.notEqual(first, otherReference);
  assert.notEqual(first, nextCycle);
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

test('agrupa respostas diretas à publicação por alvo, ciclo e janela', () => {
  const first = buildCommunityPostReplyNotificationId(
    'community-1',
    'post-1',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000
  );
  const sameWindow = buildCommunityPostReplyNotificationId(
    'community-1',
    'post-1',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000 + 60_000
  );
  const otherPost = buildCommunityPostReplyNotificationId(
    'community-1',
    'post-2',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000 + 60_000
  );
  const nextCycle = buildCommunityPostReplyNotificationId(
    'community-1',
    'post-1',
    'author-1',
    MEMBERSHIP_CYCLE + 1,
    1_800_000_000_000 + 60_000
  );

  assert.equal(first, sameWindow);
  assert.notEqual(first, otherPost);
  assert.notEqual(first, nextCycle);
  assert.match(first, /^community_post_replies_[a-f0-9]{40}$/);
});

test('resume respostas diretas à publicação sem copiar conteúdo', () => {
  assert.deepEqual(buildCommunityPostReplyNotificationCopy({
    existingActivityCount: 0,
    actorLabel: ' Pessoa\nSegura ',
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Nova resposta à sua publicação',
    body: 'Pessoa Segura respondeu à sua publicação em Comunidade Teste.',
    activityCount: 1,
  });

  assert.deepEqual(buildCommunityPostReplyNotificationCopy({
    existingActivityCount: 2,
    actorLabel: 'Outra pessoa',
    communityName: 'Comunidade Teste',
  }), {
    title: '3 novas respostas à sua publicação',
    body: 'Sua publicação em Comunidade Teste recebeu 3 novas respostas.',
    activityCount: 3,
  });
});

test('gera resultado determinístico de revisão por ciclo do pedido', () => {
  const approved = buildCommunityMembershipReviewNotificationId(
    'community-1',
    'member-1',
    1_800_000_000_000,
    'approved'
  );
  const same = buildCommunityMembershipReviewNotificationId(
    'community-1',
    'member-1',
    1_800_000_000_000,
    'approved'
  );
  const nextCycle = buildCommunityMembershipReviewNotificationId(
    'community-1',
    'member-1',
    1_800_000_000_001,
    'approved'
  );
  const rejected = buildCommunityMembershipReviewNotificationId(
    'community-1',
    'member-1',
    1_800_000_000_000,
    'rejected'
  );

  assert.equal(approved, same);
  assert.notEqual(approved, nextCycle);
  assert.notEqual(approved, rejected);
  assert.match(approved, /^community_membership_review_[a-f0-9]{40}$/);
});

test('gera cópia segura para aprovação e rejeição de entrada', () => {
  assert.deepEqual(buildCommunityMembershipReviewNotificationCopy({
    outcome: 'approved',
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Entrada aprovada',
    body: 'Seu pedido para entrar em Comunidade Teste foi aprovado.',
  });

  assert.deepEqual(buildCommunityMembershipReviewNotificationCopy({
    outcome: 'rejected',
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Pedido de entrada não aprovado',
    body: 'Seu pedido para entrar em Comunidade Teste não foi aprovado.',
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
  assert.equal(
    buildCommunityNotificationRoute('community:1', 'post:1'),
    '/dashboard/comunidades/community%3A1?post=post%3A1'
  );
  assert.equal(
    buildCommunityNotificationRoute('community:1', 'post:1', 'comment:2'),
    '/dashboard/comunidades/community%3A1?post=post%3A1&comentario=comment%3A2'
  );
});
