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
