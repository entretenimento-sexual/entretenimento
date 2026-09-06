// functions/src/community/community-my-page-scan.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectCommunityMyPageIncrementally,
} from './community-my-page-scan.policy';

interface FakeDocument {
  readonly id: number;
  readonly valid: boolean;
}

function createHarness(documents: readonly FakeDocument[]) {
  const requestedBatchSizes: number[] = [];
  const validatedDocumentIds: number[] = [];

  return {
    requestedBatchSizes,
    validatedDocumentIds,
    loadBatch: async (
      afterDocument: FakeDocument | null,
      limit: number
    ): Promise<readonly FakeDocument[]> => {
      requestedBatchSizes.push(limit);
      const startIndex = afterDocument
        ? documents.findIndex((document) => document.id === afterDocument.id) + 1
        : 0;

      return documents.slice(startIndex, startIndex + limit);
    },
    validateDocuments: async (
      batch: readonly FakeDocument[]
    ): Promise<readonly (string | null)[]> => {
      validatedDocumentIds.push(...batch.map((document) => document.id));
      return batch.map((document) =>
        document.valid ? `community-${document.id}` : null
      );
    },
  };
}

test('para no primeiro lote saudável e não revalida o documento de buffer', async () => {
  const harness = createHarness(
    Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      valid: true,
    }))
  );

  const result = await collectCommunityMyPageIncrementally({
    limit: 4,
    loadBatch: harness.loadBatch,
    validateDocuments: harness.validateDocuments,
  });

  assert.deepEqual(result.items, [
    'community-1',
    'community-2',
    'community-3',
    'community-4',
  ]);
  assert.deepEqual(harness.requestedBatchSizes, [5]);
  assert.deepEqual(harness.validatedDocumentIds, [1, 2, 3, 4]);
  assert.equal(result.lastConsumedDocument?.id, 4);
  assert.equal(result.mayHaveAnotherPage, true);
  assert.equal(result.validatedDocumentCount, 4);
});

test('usa o buffer somente quando uma entrada anterior está obsoleta', async () => {
  const harness = createHarness([
    { id: 1, valid: false },
    { id: 2, valid: true },
    { id: 3, valid: true },
    { id: 4, valid: true },
    { id: 5, valid: true },
    { id: 6, valid: true },
  ]);

  const result = await collectCommunityMyPageIncrementally({
    limit: 4,
    loadBatch: harness.loadBatch,
    validateDocuments: harness.validateDocuments,
  });

  assert.deepEqual(result.items, [
    'community-2',
    'community-3',
    'community-4',
    'community-5',
  ]);
  assert.deepEqual(harness.requestedBatchSizes, [5]);
  assert.deepEqual(harness.validatedDocumentIds, [1, 2, 3, 4, 5]);
  assert.equal(result.lastConsumedDocument?.id, 5);
  assert.equal(result.mayHaveAnotherPage, true);
});

test('expande a varredura apenas quando necessário e preserva o teto anterior', async () => {
  const harness = createHarness(
    Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      valid: false,
    }))
  );

  const result = await collectCommunityMyPageIncrementally({
    limit: 4,
    loadBatch: harness.loadBatch,
    validateDocuments: harness.validateDocuments,
  });

  assert.deepEqual(result.items, []);
  assert.deepEqual(harness.requestedBatchSizes, [5, 5, 3]);
  assert.deepEqual(
    harness.validatedDocumentIds,
    Array.from({ length: 13 }, (_, index) => index + 1)
  );
  assert.equal(result.lastConsumedDocument?.id, 13);
  assert.equal(result.mayHaveAnotherPage, true);
  assert.equal(result.validatedDocumentCount, 13);
});

test('encerra sem cursor de continuação quando a fonte termina antes do lote', async () => {
  const harness = createHarness([
    { id: 1, valid: false },
    { id: 2, valid: true },
    { id: 3, valid: false },
  ]);

  const result = await collectCommunityMyPageIncrementally({
    limit: 4,
    loadBatch: harness.loadBatch,
    validateDocuments: harness.validateDocuments,
  });

  assert.deepEqual(result.items, ['community-2']);
  assert.deepEqual(harness.requestedBatchSizes, [5]);
  assert.deepEqual(harness.validatedDocumentIds, [1, 2, 3]);
  assert.equal(result.lastConsumedDocument?.id, 3);
  assert.equal(result.mayHaveAnotherPage, false);
});
