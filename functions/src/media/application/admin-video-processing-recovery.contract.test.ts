import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(__dirname, '../../../');
const handler = readFileSync(
  resolve(root, 'src/media/application/admin-video-processing-recovery.handler.ts'),
  'utf8'
);
const client = readFileSync(
  resolve(root, '../src/app/core/services/moderation/admin-video-processing-recovery.service.ts'),
  'utf8'
);
const component = readFileSync(
  resolve(root, '../src/app/admin-dashboard/video-moderation/video-moderation.component.ts'),
  'utf8'
);
const template = readFileSync(
  resolve(root, '../src/app/admin-dashboard/video-moderation/video-moderation.component.html'),
  'utf8'
);

test('provider reconfirmation is explicit and guarded within the admin transaction', () => {
  assert.ok(handler.includes("command.action === 'RECHECK_UNCONFIRMED'"));
  assert.ok(handler.includes('!isUnconfirmedVideoSubmission({ ...job, state })'));
  assert.ok(handler.includes("jobPatch['leaseUntil'] = 0"));
  assert.ok(handler.includes("videoPatch['processingStage'] = 'confirming_submission'"));
  assert.ok(handler.includes('action: command.action'));
});

test('legacy uncertain failed jobs cannot be retried before provider verification', () => {
  const retryStart = handler.indexOf('async function retryFailedJob(');
  const mutateStart = handler.indexOf('async function mutateExistingJob(', retryStart);
  const retry = handler.slice(retryStart, mutateStart);

  assert.ok(retry.includes('isUnsafeVideoProcessingRetry'));
  assert.equal(retry.split('isUnsafeVideoProcessingRetry').length - 1, 2);
});

test('the admin frontend does not silently turn unknown actions into rechecks', () => {
  assert.ok(client.includes("'RECHECK_UNCONFIRMED'"));
  assert.ok(client.includes("return throwError(() => new Error('Ação administrativa desconhecida.'))"));
  assert.ok(client.includes(': null;'));
  assert.ok(component.includes("case 'RECHECK_UNCONFIRMED':"));
  assert.ok(template.includes('item.requiresProviderReview'));
});

test('admin flags overdue cancellation separately from unconfirmed provider jobs', () => {
  assert.ok(handler.includes('isOverdueVideoCancellation('));
  assert.ok(handler.includes('requiresOperationalAttention:'));
  assert.ok(client.includes('requiresOperationalAttention:'));
  assert.ok(template.includes('item.requiresOperationalAttention'));
  assert.ok(template.includes('Este alerta não confirma falha do Transcoder'));
});

test('explicit provider recheck is version-fenced, logged, rate-limited and not a POST', () => {
  assert.ok(handler.includes("command.action === 'RECHECK_PROVIDER'"));
  assert.ok(handler.includes('!isProviderPollReviewRequired({ ...job, state })'));
  assert.ok(handler.includes("jobPatch['nextAttemptAt'] = now"));
  assert.ok(handler.includes("jobPatch['providerPollReviewRequired'] = false"));
  assert.ok(handler.includes('job.processingVersion !== command.expectedProcessingVersion'));
  assert.ok(client.includes('expectedProcessingVersion:'));
  assert.ok(component.includes('expectedProcessingVersion: item.processingVersion'));
  assert.ok(handler.includes("'admin-video-processing-recovery-mutate'"));
  assert.ok(handler.includes('lastAdminOperationId: command.operationId') ||
    handler.includes('lastAdminOperationId: command.operationId,'));
  assert.ok(client.includes("'RECHECK_PROVIDER'"));
  assert.ok(component.includes("case 'RECHECK_PROVIDER':"));
  assert.ok(template.includes('item.providerPollReviewRequired'));
  assert.ok(template.includes('item.providerPollFailureCount'));
});

test('c17 recovery consumes every document from bounded per-state cursor lanes', () => {
  assert.ok(handler.includes('orderBy(FieldPath.documentId())'));
  assert.ok(handler.includes('query.startAfter(cursor[state])'));
  assert.ok(handler.includes('parseRecoveryCursor(request.data?.cursor)'));
  assert.ok(handler.includes('documents.slice(0, perStateLimit)'));
  assert.ok(handler.includes('nextCursor: hasMore ? encodeRecoveryCursor(next) : null'));
  assert.ok(!handler.includes('items: items.slice(0, limit)'));
  assert.ok(handler.includes("orderScope: 'WITHIN_PAGE'"));
});

test('c18 guards legacy timestamps without enabling unbuilt global indexes', () => {
  const index = JSON.parse(readFileSync(resolve(root, '../firestore.indexes.json'), 'utf8'));
  const indexes = index.indexes as Array<{
    collectionGroup: string;
    fields: Array<{ fieldPath: string }>;
  }>;
  for (const [collection, field] of [
    ['media_video_processing_jobs', 'updatedAt'],
    ['media_video_processing_jobs', 'createdAt'],
    ['media_video_terminal_temp_cleanup_jobs', 'updatedAt'],
  ]) {
    assert.ok(indexes.some(entry =>
      entry.collectionGroup === collection &&
      entry.fields.map(f => f.fieldPath).join(',') ===
        ['state', field, '__name__'].join(',')
    ));
  }
  // Prepared definitions are not deployed; production stays on existing ID cursor.
  assert.ok(handler.includes('orderBy(FieldPath.documentId())'));
  assert.ok(!handler.includes("orderBy('updatedAt')"));
  assert.ok(handler.includes("timestampEvidence !== 'UNVERIFIED'"));
  assert.ok(handler.includes("timestampEvidence === 'UNVERIFIED'"));
  assert.ok(client.includes('timestampEvidence:'));
  assert.ok(template.includes('Data não verificada'));
});
