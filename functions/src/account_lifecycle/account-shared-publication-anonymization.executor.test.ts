import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeSharedPublicationAnonymizationDomain,
  type AccountSharedPublicationAnonymizationAdapter,
} from './account-shared-publication-anonymization.executor';

class FakeSharedPublicationAdapter
implements AccountSharedPublicationAnonymizationAdapter
{
  authors: number[] = [0];
  replyTargets: number[] = [0];
  reactions: number[] = [0];
  feedAuthors: number[] = [0];
  feedCommentAuthors: number[] = [0];
  feedRequests: number[] = [0];
  feedReactions: number[] = [0];
  feedActionActors: number[] = [0];
  feedAudit: number[] = [0];
  feedUserState = 0;
  error: unknown = null;

  async anonymizePhotoCommentAuthorsPage(): Promise<number> {
    if (this.error) throw this.error;
    return this.authors.shift() ?? 0;
  }

  async anonymizePhotoCommentReplyTargetsPage(): Promise<number> {
    return this.replyTargets.shift() ?? 0;
  }

  async deletePhotoReactionReferencesPage(): Promise<number> {
    return this.reactions.shift() ?? 0;
  }

  async anonymizeCommunityFeedPostAuthorsPage(): Promise<number> {
    return this.feedAuthors.shift() ?? 0;
  }

  async anonymizeCommunityFeedCommentAuthorsPage(): Promise<number> {
    return this.feedCommentAuthors.shift() ?? 0;
  }

  async deleteCommunityFeedRequestsPage(): Promise<number> {
    return this.feedRequests.shift() ?? 0;
  }

  async deleteCommunityFeedReactionsPage(): Promise<number> {
    return this.feedReactions.shift() ?? 0;
  }

  async anonymizeCommunityFeedPostActionActorsPage(): Promise<number> {
    return this.feedActionActors.shift() ?? 0;
  }

  async anonymizeCommunityFeedAuditPage(): Promise<number> {
    return this.feedAudit.shift() ?? 0;
  }

  async deleteCommunityFeedUserState(): Promise<number> {
    return this.feedUserState;
  }
}

test('shared publication domain anonymizes photo and community authorship', async () => {
  const adapter = new FakeSharedPublicationAdapter();
  adapter.authors = [3];
  adapter.replyTargets = [2];
  adapter.reactions = [4];
  adapter.feedAuthors = [2];
  adapter.feedCommentAuthors = [2];
  adapter.feedRequests = [2];
  adapter.feedReactions = [2];
  adapter.feedActionActors = [1];
  adapter.feedAudit = [3];
  adapter.feedUserState = 1;

  const result = await executeSharedPublicationAnonymizationDomain(adapter, {
    uid: 'publication-owner',
    pageSize: 10,
    maxPagesPerStep: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.processed, 22);
  assert.deepEqual(result.details, {
    photoCommentAuthorsAnonymized: 3,
    photoCommentReplyTargetsAnonymized: 2,
    photoReactionsDeleted: 4,
    communityFeedPostAuthorsAnonymized: 2,
    communityFeedCommentAuthorsAnonymized: 2,
    communityFeedRequestsDeleted: 2,
    communityFeedReactionsDeleted: 2,
    communityFeedActionActorsAnonymized: 1,
    communityFeedAuditAnonymized: 3,
    communityFeedUserStateDeleted: 1,
  });
});

test('pagination limit keeps shared publications partial', async () => {
  const adapter = new FakeSharedPublicationAdapter();
  adapter.authors = [2, 2];

  const result = await executeSharedPublicationAnonymizationDomain(adapter, {
    uid: 'publication-pagination-owner',
    pageSize: 2,
    maxPagesPerStep: 2,
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.blocker, 'pagination-limit-reached');
  assert.equal(result.details?.['photoCommentAuthorsAnonymized'], 4);
});

test('adapter errors remain isolated in shared publication domain', async () => {
  const adapter = new FakeSharedPublicationAdapter();
  adapter.error = Object.assign(new Error('query unavailable'), {
    code: 'firestore/unavailable',
  });

  const result = await executeSharedPublicationAnonymizationDomain(adapter, {
    uid: 'publication-error-owner',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'firestore/unavailable');
  assert.equal(result.details?.['errorMessage'], 'query unavailable');
});

test('invalid uid fails before publication queries', async () => {
  const adapter = new FakeSharedPublicationAdapter();

  const result = await executeSharedPublicationAnonymizationDomain(adapter, {
    uid: '../invalid',
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(adapter.authors, [0]);
  assert.deepEqual(adapter.replyTargets, [0]);
  assert.deepEqual(adapter.reactions, [0]);
  assert.deepEqual(adapter.feedAuthors, [0]);
  assert.deepEqual(adapter.feedCommentAuthors, [0]);
  assert.deepEqual(adapter.feedRequests, [0]);
  assert.deepEqual(adapter.feedReactions, [0]);
  assert.deepEqual(adapter.feedActionActors, [0]);
  assert.deepEqual(adapter.feedAudit, [0]);
});
