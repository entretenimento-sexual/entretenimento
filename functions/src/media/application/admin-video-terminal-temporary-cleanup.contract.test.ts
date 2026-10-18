import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(__dirname, '../../../');
const file = (name: string) => readFileSync(resolve(root, name), 'utf8');
const handler = file('src/media/application/admin-video-terminal-temporary-cleanup.handler.ts');
const firestore = file('src/media/application/video-terminal-temporary-cleanup.firestore.ts');
const worker = file('src/media/application/cleanup-video-rotation-input.handler.ts');
const policy = file('src/media/application/video-terminal-temporary-cleanup.policy.ts');
const index = file('src/media/index.ts');
const client = file('../src/app/core/services/moderation/admin-video-terminal-temporary-cleanup.service.ts');
const component = file('../src/app/admin-dashboard/video-moderation/video-moderation.component.ts');
const template = file('../src/app/admin-dashboard/video-moderation/video-moderation.component.html');
const runbook = file('../docs/video-processing-runbook.md');

test('admin cleanup diagnostics are bounded, rate-limited and do not trigger deletion', () => {
  assert.ok(handler.includes('listVideoTerminalTemporaryCleanupReviews = onCall'));
  assert.ok(handler.includes(".where('state', '==', 'review')"));
  assert.ok(handler.includes('.where(\'state\', \'==\', \'review\').count().get()'));
  assert.ok(handler.includes('samplePartial: totalReview > items.length'));
  assert.ok(handler.includes('assertCallableAppCheck(request.app)'));
  assert.ok(handler.includes('consumeBackendRateLimitQuota'));
  assert.ok(!handler.includes('.delete('));
});

test('admin recheck is CAS-fenced, auditable and delegates GCS deletion to existing worker', () => {
  assert.ok(firestore.includes('queue.processingVersion !== command.processingVersion'));
  assert.ok(firestore.includes('queue.updatedAt !== command.expectedUpdatedAt'));
  assert.ok(firestore.includes("queue.state !== 'review'"));
  assert.ok(firestore.includes('queue.lastAdminOperationId === command.operationId'));
  assert.ok(firestore.includes('transaction.create(auditRef'));
  assert.ok(firestore.includes('terminalCleanupQueueId(queue.jobId, queue.processingVersion)'));
  assert.ok(firestore.includes('selectImmutableCancellationTarget'));
  assert.ok(firestore.includes('snapshotMatchesQueue(queue, queue.snapshot)'));
  assert.ok(worker.includes('cleanupTerminalVideoTemporaryAssets('));
  assert.ok(policy.includes('matchesProviderTerminalEvidence'));
  assert.ok(policy.includes('ports.deletePinned('));
  assert.ok(client.includes('recheckVideoTerminalTemporaryCleanup'));
  assert.ok(component.includes('confirmTerminalCleanupRecheck('));
  assert.ok(template.includes('review.recheckable'));
  assert.ok(index.includes('listVideoTerminalTemporaryCleanupReviews'));
  assert.ok(runbook.includes('recheckVideoTerminalTemporaryCleanup'));
});

test('c17 terminal review pagination uses bounded index-safe document ID cursors', () => {
  assert.ok(handler.includes('orderBy(FieldPath.documentId())'));
  assert.ok(handler.includes('query.startAfter(cursor)'));
  assert.ok(handler.includes('query.limit(limit + 1).get()'));
  assert.ok(handler.includes('nextCursor: hasMore && consumed.length'));
  assert.ok(handler.includes("orderScope: 'WITHIN_PAGE'"));
});
