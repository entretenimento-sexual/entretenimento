// functions/src/community/community-purge.executor.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_PURGE_REFERENCE_KINDS,
  CommunityPurgeExecutionAdapter,
  CommunityPurgeReferenceKind,
  executeCommunityPurge,
} from './community-purge.executor';

class FakeAdapter implements CommunityPurgeExecutionAdapter {
  readonly referenceCalls: CommunityPurgeReferenceKind[] = [];
  readonly readinessCalls: string[] = [];
  readonly queues = new Map<CommunityPurgeReferenceKind, number[]>();
  readiness: boolean[] = [true, true];
  projectionRootsDeleted = 0;
  communityRootsDeleted = 0;
  projectionDeleteCalls = 0;
  communityDeleteCalls = 0;
  throwOnKind: CommunityPurgeReferenceKind | null = null;

  async deleteReferencePage(
    _communityId: string,
    kind: CommunityPurgeReferenceKind,
    _limit: number
  ): Promise<number> {
    this.referenceCalls.push(kind);
    if (this.throwOnKind === kind) {
      throw new Error(`falha em ${kind}`);
    }

    const queue = this.queues.get(kind) ?? [0];
    const value = queue.shift() ?? 0;
    this.queues.set(kind, queue);
    return value;
  }

  async confirmPurgeReadiness(communityId: string): Promise<boolean> {
    this.readinessCalls.push(communityId);
    return this.readiness.shift() ?? false;
  }

  async deleteProjectionRoots(_communityId: string): Promise<number> {
    this.projectionDeleteCalls += 1;
    return this.projectionRootsDeleted;
  }

  async deleteCommunityRoots(_communityId: string): Promise<number> {
    this.communityDeleteCalls += 1;
    return this.communityRootsDeleted;
  }
}

test('purge completo limpa referências, revalida duas vezes e só então apaga raízes', async () => {
  const adapter = new FakeAdapter();
  adapter.projectionRootsDeleted = 4;
  adapter.communityRootsDeleted = 5;

  const result = await executeCommunityPurge(adapter, {
    communityId: 'community-1',
    pageSize: 10,
    maxPagesPerStep: 5,
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(adapter.referenceCalls, COMMUNITY_PURGE_REFERENCE_KINDS);
  assert.deepEqual(adapter.readinessCalls, ['community-1', 'community-1']);
  assert.equal(adapter.projectionDeleteCalls, 1);
  assert.equal(adapter.communityDeleteCalls, 1);
  assert.equal(result.details['projectionRootsDeleted'], 4);
  assert.equal(result.details['communityRootsDeleted'], 5);
});

test('executor é idempotente quando referências e raízes já não existem', async () => {
  const adapter = new FakeAdapter();

  const result = await executeCommunityPurge(adapter, {
    communityId: 'community-1',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.processed, 0);
  assert.equal(adapter.projectionDeleteCalls, 1);
  assert.equal(adapter.communityDeleteCalls, 1);
});

test('pagina até uma resposta menor que pageSize', async () => {
  const adapter = new FakeAdapter();
  adapter.queues.set('creation_requests', [2, 2, 1]);

  const result = await executeCommunityPurge(adapter, {
    communityId: 'community-1',
    pageSize: 2,
    maxPagesPerStep: 5,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.details['creation_requestsDeleted'], 5);
  assert.equal(
    adapter.referenceCalls.filter((kind) => kind === 'creation_requests').length,
    3
  );
});

test('limite de paginação bloqueia qualquer exclusão de raiz', async () => {
  const adapter = new FakeAdapter();
  adapter.queues.set('creation_requests', [2, 2]);

  const result = await executeCommunityPurge(adapter, {
    communityId: 'community-1',
    pageSize: 2,
    maxPagesPerStep: 2,
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.blocker, 'pagination-limit-reached');
  assert.equal(adapter.readinessCalls.length, 0);
  assert.equal(adapter.projectionDeleteCalls, 0);
  assert.equal(adapter.communityDeleteCalls, 0);
});

test('readiness alterada antes das projeções bloqueia destruição', async () => {
  const adapter = new FakeAdapter();
  adapter.readiness = [false];

  const result = await executeCommunityPurge(adapter, {
    communityId: 'community-1',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.blocker, 'readiness-changed-before-projections');
  assert.equal(adapter.projectionDeleteCalls, 0);
  assert.equal(adapter.communityDeleteCalls, 0);
});

test('readiness alterada após limpar projeções preserva árvore comunitária', async () => {
  const adapter = new FakeAdapter();
  adapter.readiness = [true, false];
  adapter.projectionRootsDeleted = 3;

  const result = await executeCommunityPurge(adapter, {
    communityId: 'community-1',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.blocker, 'readiness-changed-before-final-delete');
  assert.equal(adapter.projectionDeleteCalls, 1);
  assert.equal(adapter.communityDeleteCalls, 0);
  assert.equal(result.details['projectionRootsDeleted'], 3);
});

test('falha de adapter encerra em failed sem avançar para raízes', async () => {
  const adapter = new FakeAdapter();
  adapter.throwOnKind = 'feed_requests';

  const result = await executeCommunityPurge(adapter, {
    communityId: 'community-1',
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.details['errorMessage']), /feed_requests/);
  assert.equal(adapter.projectionDeleteCalls, 0);
  assert.equal(adapter.communityDeleteCalls, 0);
});

test('ID inválido falha antes de chamar o adapter', async () => {
  const adapter = new FakeAdapter();

  const result = await executeCommunityPurge(adapter, {
    communityId: '../community-1',
  });

  assert.equal(result.status, 'failed');
  assert.equal(adapter.referenceCalls.length, 0);
  assert.equal(adapter.readinessCalls.length, 0);
  assert.equal(adapter.projectionDeleteCalls, 0);
  assert.equal(adapter.communityDeleteCalls, 0);
});
