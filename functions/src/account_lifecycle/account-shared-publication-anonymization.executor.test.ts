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
}

test('shared publication domain anonymizes comments and removes reactions', async () => {
  const adapter = new FakeSharedPublicationAdapter();
  adapter.authors = [3];
  adapter.replyTargets = [2];
  adapter.reactions = [4];

  const result = await executeSharedPublicationAnonymizationDomain(adapter, {
    uid: 'publication-owner',
    pageSize: 10,
    maxPagesPerStep: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.processed, 9);
  assert.deepEqual(result.details, {
    photoCommentAuthorsAnonymized: 3,
    photoCommentReplyTargetsAnonymized: 2,
    photoReactionsDeleted: 4,
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
});
