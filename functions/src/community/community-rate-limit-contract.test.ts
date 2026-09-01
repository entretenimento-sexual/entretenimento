// functions/src/community/community-rate-limit-contract.test.ts
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  type CommunityRateLimitAction,
  getCommunityRateLimitPolicy,
} from './community-rate-limit.policy';

const communitySourceDirectory = path.resolve(__dirname, '../../src/community');
const repositoryRoot = path.resolve(__dirname, '../../..');
const frontendRateLimitMessagesPath = path.join(
  repositoryRoot,
  'src/app/community/presentation/community-rate-limit.messages.ts'
);
const DIRECT_GENERIC_RATE_LIMIT_IMPORT =
  '../media/application/backend-rate-limit.service';

const PROTECTED_CALLSITES: Readonly<Record<string, CommunityRateLimitAction>> =
  Object.freeze({
    'community-feed-write.handler.ts': 'feed_post',
    'community-feed-comment-write.handler.ts': 'feed_conversation',
    'community-feed-reaction.handler.ts': 'feed_reaction',
    'report-community-feed-post.handler.ts': 'feed_report_post',
    'report-community-feed-comment.handler.ts': 'feed_report_comment',
    'report-community-feed-comment-reply.handler.ts': 'feed_report_reply',
    'send-community-invite.handler.ts': 'invite_send',
    'request-community-membership.handler.ts': 'membership_request',
    'community-membership-management.handler.ts': 'membership_review',
    'community-member-management.handler.ts': 'member_management',
    'update-community-settings.handler.ts': 'settings_update',
    'community-ownership-lifecycle.handler.ts': 'ownership_mutation',
    'community-feed-moderation.handler.ts': 'content_moderation',
    'community-feed-comment-moderation.handler.ts': 'content_moderation',
    'community-feed-comment-reply-moderation.handler.ts': 'content_moderation',
    'community-topic-moderation.handler.ts': 'content_moderation',
    'review-community-feed-post-report.handler.ts': 'content_moderation',
    'review-community-feed-comment-report.handler.ts': 'content_moderation',
    'review-community-feed-comment-reply-report.handler.ts': 'content_moderation',
  });

function listProductionTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listProductionTypeScriptFiles(entryPath);
    if (!entry.isFile() || !entry.name.endsWith('.ts')) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
      return [];
    }
    return [entryPath];
  });
}

describe('Community anti-abuse architecture', () => {
  it('impede handlers Community de contornarem o adapter central', () => {
    const bypasses = listProductionTypeScriptFiles(communitySourceDirectory)
      .filter((filePath) => path.basename(filePath) !== 'community-rate-limit.service.ts')
      .filter((filePath) =>
        readFileSync(filePath, 'utf8').includes(DIRECT_GENERIC_RATE_LIMIT_IMPORT)
      )
      .map((filePath) => path.relative(communitySourceDirectory, filePath));

    assert.deepEqual(bypasses, []);
  });

  it('mantém os callsites críticos ligados à ação canônica correspondente', () => {
    for (const [fileName, action] of Object.entries(PROTECTED_CALLSITES)) {
      const source = readFileSync(
        path.join(communitySourceDirectory, fileName),
        'utf8'
      );

      assert.match(source, /consumeCommunityRateLimit\s*\(/);
      assert.equal(
        source.includes(`action: '${action}'`),
        true,
        `${fileName} deve consumir a ação ${action}`
      );
    }
  });

  it('mantém todo reason de rate limit coberto por mensagem segura de UX', () => {
    const frontendMessages = readFileSync(frontendRateLimitMessagesPath, 'utf8');
    const actions = Object.values(PROTECTED_CALLSITES);

    for (const action of new Set(actions)) {
      const reason = getCommunityRateLimitPolicy(action).reason;
      assert.equal(
        frontendMessages.includes(`${reason}:`),
        true,
        `Mensagem ausente para ${reason}`
      );
    }
  });
});
