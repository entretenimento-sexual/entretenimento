import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(__dirname, '../../../');
const file = (relative: string) => readFileSync(resolve(root, relative), 'utf8');
const scheduler = file('src/media/application/video-processing.handler.ts');
const core = file('src/media/application/video-scheduler-observability.firestore.ts');
const status = file('src/media/application/admin-video-processing-status.handler.ts');
const terminal = file('src/media/application/cleanup-video-rotation-input.handler.ts');
const client = file('../src/app/core/services/moderation/admin-video-moderation.service.ts');
const component = file('../src/app/admin-dashboard/video-moderation/video-moderation.component.ts');
const template = file('../src/app/admin-dashboard/video-moderation/video-moderation.component.html');
const doc = file('../docs/video-processing-runbook.md');

test('submission and reconciliation use the same bounded cycle logger and collector', () => {
  assert.ok(scheduler.includes("runObservedVideoScheduler(db, 'submitQueuedVideoProcessing'"));
  assert.ok(scheduler.includes("runObservedVideoScheduler(db, 'reconcileVideoProcessing'"));
  assert.ok(scheduler.includes('await runBatch(tasks,'));
  assert.ok(scheduler.includes('processPendingVideoTerminalTemporaryCleanup()'));
  assert.ok(scheduler.includes('terminalReviewRequired: terminal.reviewRequired'));
  assert.ok(core.includes("'VIDEO_MEDIA_SCHEDULER_STARTED'"));
  assert.ok(core.includes("'VIDEO_MEDIA_SCHEDULER_FINISHED'"));
  assert.ok(core.includes("'VIDEO_MEDIA_SCHEDULER_FAILED'"));
  assert.ok(core.includes('throw error;'));
});

test('cancellation keeps its existing logs and records one aggregate result', () => {
  assert.ok(scheduler.includes("'VIDEO_CANCELLATION_CYCLE_STARTED'"));
  assert.ok(scheduler.includes("'VIDEO_CANCELLATION_CYCLE_FINISHED'"));
  assert.ok(scheduler.includes("'VIDEO_CANCELLATION_CYCLE_FAILED'"));
  assert.ok(scheduler.includes("'cleanupCancelledVideoProcessing', cycleId"));
  assert.ok(scheduler.includes('bestEffortSaveVideoSchedulerCycle('));
});

test('terminal queue continues to use generation-pinned executor and bounded query', () => {
  assert.ok(terminal.includes('claimDueTerminalTemporaryCleanup('));
  assert.ok(terminal.includes('isTerminalTemporaryClaimCurrent('));
  assert.ok(terminal.includes('cleanupTerminalVideoTemporaryAssets('));
  assert.ok(terminal.includes('.limit(CLEANUP_BATCH_SIZE).get()'));
  assert.ok(terminal.includes('const outcome = await processCleanupDoc('));
  assert.ok(!core.includes('getGoogleVideoTranscoderJob'));
  assert.ok(!core.includes('deletePinned('));
});

test('status reads only three snapshots and displays unknown as UNVERIFIED', () => {
  assert.ok(status.includes('await db.getAll(...VIDEO_SCHEDULERS.map'));
  assert.ok(status.includes('diagnoseVideoScheduler(name, null, checkedAt)'));
  assert.ok(status.includes('assertCallableAppCheck(request.app)'));
  assert.ok(client.includes('normalizeSchedulers('));
  assert.ok(component.includes('schedulerHealthLabel('));
  assert.ok(template.includes('schedulerHealthLabel(scheduler)'));
  assert.ok(doc.includes('VIDEO_MEDIA_SCHEDULER_FAILED'));
});
