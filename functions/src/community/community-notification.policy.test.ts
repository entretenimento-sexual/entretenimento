import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allowsCommunityActivityNotifications,
  buildCommunityCommentNotificationCopy,
  buildCommunityCommentNotificationId,
  buildCommunityReactionNotificationCopy,
  buildCommunityReactionNotificationId,
  buildCommunityInviteResponseNotificationCopy,
  buildCommunityInviteResponseNotificationId,
  buildCommunityMemberLifecycleNotificationCopy,
  buildCommunityMemberLifecycleNotificationId,
  buildCommunityMembershipRequestNotificationCopy,
  buildCommunityMembershipRequestNotificationId,
  isCommunityMembershipRequestNotificationForReview,
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

test('agrupa reações por publicação, ciclo e janela diária', () => {
  const first = buildCommunityReactionNotificationId(
    'community-1',
    'post-1',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000
  );
  const sameWindow = buildCommunityReactionNotificationId(
    'community-1',
    'post-1',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000 + 60_000
  );
  const otherPost = buildCommunityReactionNotificationId(
    'community-1',
    'post-2',
    'author-1',
    MEMBERSHIP_CYCLE,
    1_800_000_000_000 + 60_000
  );

  assert.equal(first, sameWindow);
  assert.notEqual(first, otherPost);
  assert.match(first, /^community_reactions_[a-f0-9]{40}$/);
  assert.deepEqual(buildCommunityReactionNotificationCopy({
    existingActivityCount: 0,
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Nova reação',
    body: 'Sua publicação em Comunidade Teste recebeu uma nova reação.',
    activityCount: 1,
  });
  assert.deepEqual(buildCommunityReactionNotificationCopy({
    existingActivityCount: 2,
    communityName: 'Comunidade Teste',
  }), {
    title: '3 novas reações',
    body: 'Sua publicação em Comunidade Teste recebeu novas reações.',
    activityCount: 3,
  });
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

test('gera retorno determinístico para resposta de convite', () => {
  const accepted = buildCommunityInviteResponseNotificationId(
    'community:community-1:to:member-1',
    'sender-1',
    'accepted'
  );
  const same = buildCommunityInviteResponseNotificationId(
    'community:community-1:to:member-1',
    'sender-1',
    'accepted'
  );
  const declined = buildCommunityInviteResponseNotificationId(
    'community:community-1:to:member-1',
    'sender-1',
    'declined'
  );

  assert.equal(accepted, same);
  assert.notEqual(accepted, declined);
  assert.match(accepted, /^community_invite_response_[a-f0-9]{40}$/);
  assert.deepEqual(buildCommunityInviteResponseNotificationCopy({
    outcome: 'accepted',
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Convite aceito',
    body: 'Seu convite para Comunidade Teste foi aceito.',
  });
  assert.deepEqual(buildCommunityInviteResponseNotificationCopy({
    outcome: 'declined',
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Convite recusado',
    body: 'Seu convite para Comunidade Teste foi recusado.',
  });
});

test('gera aviso de lifecycle de membro por ciclo e ação', () => {
  const removed = buildCommunityMemberLifecycleNotificationId(
    'community-1',
    'member-1',
    MEMBERSHIP_CYCLE,
    'remove'
  );
  const blocked = buildCommunityMemberLifecycleNotificationId(
    'community-1',
    'member-1',
    MEMBERSHIP_CYCLE,
    'block'
  );
  const nextCycle = buildCommunityMemberLifecycleNotificationId(
    'community-1',
    'member-1',
    MEMBERSHIP_CYCLE + 1,
    'remove'
  );

  assert.notEqual(removed, blocked);
  assert.notEqual(removed, nextCycle);
  assert.match(removed, /^community_member_lifecycle_[a-f0-9]{40}$/);

  assert.deepEqual(buildCommunityMemberLifecycleNotificationCopy({
    action: 'remove',
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Participação encerrada',
    body: 'Sua participação em Comunidade Teste foi encerrada pela gestão.',
  });
  assert.deepEqual(buildCommunityMemberLifecycleNotificationCopy({
    action: 'block',
    communityName: 'Comunidade Teste',
  }), {
    title: 'Acesso à Comunidade bloqueado',
    body: 'Seu acesso a Comunidade Teste foi bloqueado pela gestão.',
  });
  assert.deepEqual(buildCommunityMemberLifecycleNotificationCopy({
    action: 'unblock',
    communityName: 'Comunidade Teste',
  }), {
    title: 'Bloqueio removido',
    body: 'O bloqueio de acesso a Comunidade Teste foi removido.',
  });
});

test('gera pedido de entrada determinístico por ciclo', () => {
  const first = buildCommunityMembershipRequestNotificationId(
    'community-1',
    'member-1',
    1_800_000_000_000
  );
  const same = buildCommunityMembershipRequestNotificationId(
    'community-1',
    'member-1',
    1_800_000_000_000
  );
  const nextCycle = buildCommunityMembershipRequestNotificationId(
    'community-1',
    'member-1',
    1_800_000_000_001
  );

  assert.equal(first, same);
  assert.notEqual(first, nextCycle);
  assert.match(first, /^community_membership_request_[a-f0-9]{40}$/);
  assert.deepEqual(buildCommunityMembershipRequestNotificationCopy({
    communityName: ' Comunidade Teste ',
  }), {
    title: 'Novo pedido de entrada',
    body: 'Há um novo pedido para entrar em Comunidade Teste.',
  });
});

test('valida o alerta de pedido antes de resolvê-lo na revisão', () => {
  assert.equal(
    isCommunityMembershipRequestNotificationForReview({
      type: 'community.membership.requested',
      communityId: 'community-1',
      actorUid: 'member-1',
    }, 'community-1', 'member-1'),
    true
  );
  assert.equal(
    isCommunityMembershipRequestNotificationForReview({
      type: 'community.membership.requested',
      communityId: 'community-2',
      actorUid: 'member-1',
    }, 'community-1', 'member-1'),
    false
  );
  assert.equal(
    isCommunityMembershipRequestNotificationForReview({
      type: 'community.membership.requested',
      communityId: 'community-1',
      actorUid: 'member-2',
    }, 'community-1', 'member-1'),
    false
  );
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
