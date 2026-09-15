import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const communitySourceDirectory = path.resolve(__dirname, '../../src/community');
const reportHandlers = [
  'report-community-feed-post.handler.ts',
  'report-community-feed-comment.handler.ts',
  'report-community-feed-comment-reply.handler.ts',
] as const;

describe('community-feed-report transactional access contract', () => {
  it('revalida acesso canônico dentro da transação em toda denúncia do Mural', () => {
    for (const fileName of reportHandlers) {
      const source = readFileSync(
        path.join(communitySourceDirectory, fileName),
        'utf8'
      );
      const transactionIndex = source.indexOf('db.runTransaction');
      const transactionalAccessIndex = source.indexOf(
        'assertCommunityFeedReportAccessInTransaction(',
        transactionIndex
      );

      assert.ok(
        transactionIndex >= 0,
        `${fileName}: denúncia deve permanecer transacional.`
      );
      assert.ok(
        transactionalAccessIndex > transactionIndex,
        `${fileName}: acesso canônico deve ser relido dentro da transação.`
      );
    }
  });
});
