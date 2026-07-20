import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeRelationshipEdgeRetentionDomain,
  type AccountRelationshipEdgeRetentionAdapter,
  type BlockReferencePageSummary,
} from './account-relationship-edge-retention.executor';

const EMPTY_PAGE: BlockReferencePageSummary = {
  processed: 0,
  eventsArchived: 0,
  statesArchived: 0,
  remaining: false,
};

class FakeRelationshipEdgeAdapter
implements AccountRelationshipEdgeRetentionAdapter
{
  owned: BlockReferencePageSummary[] = [{ ...EMPTY_PAGE }];
  inbound: BlockReferencePageSummary[] = [{ ...EMPTY_PAGE }];
  error: unknown = null;

  async archiveOwnedBlockReferencePage(): Promise<BlockReferencePageSummary> {
    if (this.error) throw this.error;
    return this.owned.shift() ?? { ...EMPTY_PAGE };
  }

  async archiveInboundBlockReferencePage(): Promise<BlockReferencePageSummary> {
    return this.inbound.shift() ?? { ...EMPTY_PAGE };
  }
}

test('relationship retention archives events and states in both directions', async () => {
  const adapter = new FakeRelationshipEdgeAdapter();
  adapter.owned = [
    {
      processed: 3,
      eventsArchived: 2,
      statesArchived: 1,
      remaining: false,
    },
  ];
  adapter.inbound = [
    {
      processed: 2,
      eventsArchived: 1,
      statesArchived: 1,
      remaining: false,
    },
  ];

  const result = await executeRelationshipEdgeRetentionDomain(adapter, {
    uid: 'relationship-owner',
    pageSize: 20,
    maxPagesPerDirection: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.processed, 5);
  assert.deepEqual(result.details, {
    ownedBlockEventsArchived: 2,
    ownedBlockStatesArchived: 1,
    inboundBlockEventsArchived: 1,
    inboundBlockStatesArchived: 1,
  });
});

test('relationship retention drains multiple event pages before completion', async () => {
  const adapter = new FakeRelationshipEdgeAdapter();
  adapter.owned = [
    {
      processed: 2,
      eventsArchived: 2,
      statesArchived: 0,
      remaining: true,
    },
    {
      processed: 1,
      eventsArchived: 0,
      statesArchived: 1,
      remaining: false,
    },
  ];

  const result = await executeRelationshipEdgeRetentionDomain(adapter, {
    uid: 'relationship-pagination',
    maxPagesPerDirection: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.pages, 3);
  assert.equal(result.details?.['ownedBlockEventsArchived'], 2);
  assert.equal(result.details?.['ownedBlockStatesArchived'], 1);
});

test('relationship retention remains partial at pagination limit', async () => {
  const adapter = new FakeRelationshipEdgeAdapter();
  adapter.inbound = [
    {
      processed: 2,
      eventsArchived: 2,
      statesArchived: 0,
      remaining: true,
    },
    {
      processed: 2,
      eventsArchived: 2,
      statesArchived: 0,
      remaining: true,
    },
  ];

  const result = await executeRelationshipEdgeRetentionDomain(adapter, {
    uid: 'relationship-partial',
    maxPagesPerDirection: 2,
  });

  assert.equal(result.status, 'partial');
  assert.equal(
    result.blocker,
    'block-retention-pagination-limit-reached'
  );
});

test('relationship retention isolates adapter failures', async () => {
  const adapter = new FakeRelationshipEdgeAdapter();
  adapter.error = Object.assign(new Error('audit unavailable'), {
    code: 'firestore/unavailable',
  });

  const result = await executeRelationshipEdgeRetentionDomain(adapter, {
    uid: 'relationship-error',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'firestore/unavailable');
  assert.equal(result.details?.['errorMessage'], 'audit unavailable');
});

test('invalid uid fails before block references are read', async () => {
  const adapter = new FakeRelationshipEdgeAdapter();

  const result = await executeRelationshipEdgeRetentionDomain(adapter, {
    uid: '../invalid',
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(adapter.owned, [{ ...EMPTY_PAGE }]);
  assert.deepEqual(adapter.inbound, [{ ...EMPTY_PAGE }]);
});
