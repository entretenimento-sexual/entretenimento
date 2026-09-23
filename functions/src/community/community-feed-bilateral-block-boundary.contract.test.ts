import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(
    path.resolve(process.cwd(), 'src', relativePath),
    'utf8'
  );
}

test('leitura do Mural usa contexto bilateral agregado, não 2N reads por autor', () => {
  const blockPolicy = source(
    'friendship/application/bilateral-block-access.policy.ts'
  );
  const feedRead = source('community/community-feed-read.service.ts');
  const commentsRead = source(
    'community/get-community-feed-comments-page.handler.ts'
  );
  const repliesRead = source(
    'community/get-community-feed-comment-replies-page.handler.ts'
  );

  assert.equal(
    blockPolicy.includes('resolveBilateralBlockedUidsForActor'),
    true
  );
  assert.equal(
    blockPolicy.includes(".collectionGroup('blocks')"),
    true
  );

  for (const reader of [feedRead, commentsRead, repliesRead]) {
    assert.equal(
      reader.includes('resolveBilateralBlockedUidsForActor'),
      true
    );
    assert.equal(
      reader.includes('resolveBlockedTargetUids('),
      false,
      'Mural não pode resolver bloqueio autor a autor'
    );
  }
});

test('reply e reaction falham fechados antes da mutação quando há bloqueio bilateral', () => {
  const postWrite = source('community/community-feed-write.handler.ts');
  const commentWrite = source(
    'community/community-feed-comment-write.handler.ts'
  );
  const legacyReplyWrite = source(
    'community/community-feed-comment-reply-write.handler.ts'
  );
  const reactionWrite = source(
    'community/community-feed-reaction.handler.ts'
  );

  for (const writer of [
    postWrite,
    commentWrite,
    legacyReplyWrite,
    reactionWrite,
  ]) {
    assert.equal(
      writer.includes('assertNoActiveBilateralBlocksInTransaction'),
      true
    );
  }
});

test('notificação social do Mural é revalidada no push e removida quando nasce bloqueio', () => {
  const notificationPolicy = source(
    'community/community-notification.policy.ts'
  );
  const push = source('notifications/sendNotification.ts');
  const blockHandler = source(
    'friendship/application/manage-user-block.handler.ts'
  );

  assert.equal(
    notificationPolicy.includes(
      'isCommunityMuralActivityNotificationType'
    ),
    true
  );
  assert.equal(
    push.includes('isCommunityMuralActivityNotificationType'),
    true
  );
  assert.equal(
    push.includes('isBilateralBlockActive'),
    true
  );
  assert.equal(
    blockHandler.includes(
      'removeCommunityMuralNotificationsBetweenUsers'
    ),
    true
  );
});

test('mention semântica não possui canal paralelo capaz de contornar bloqueio', () => {
  const feedModel = source('community/community-feed.model.ts');
  const commentModel = source('community/community-feed-comment.model.ts');
  const notificationPolicy = source(
    'community/community-notification.policy.ts'
  );

  for (const model of [feedModel, commentModel]) {
    assert.equal(model.includes('mentionedUids'), false);
    assert.equal(model.includes('mentionUids'), false);
  }

  // @texto continua texto puro no Mural. Se uma mention semântica for criada,
  // o tipo já pertence à fronteira social sujeita à revalidação bilateral.
  assert.equal(
    notificationPolicy.includes("'community.mention.received'"),
    true
  );
});
