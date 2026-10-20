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
  const policy = readFileSync(resolve(root,
    'src/media/application/admin-video-global-triage.policy.ts'), 'utf8');
  assert.ok(policy.includes("timestampEvidence === 'UNVERIFIED'"));
  assert.ok(client.includes('timestampEvidence:'));
  assert.ok(template.includes('Data não verificada'));
});

test('c18b recovery coverage is derived only from consumed page documents', () => {
  assert.ok(handler.includes('auditRecoveryQueuePage(items, skippedItems)'));
  assert.ok(handler.includes('isUnconfirmedVideoSubmission({ ...job, state })'));
  assert.ok(handler.includes('documents.slice(0, perStateLimit)'));
  assert.ok(handler.includes("orderScope: 'WITHIN_PAGE'"));
  assert.ok(!handler.includes("orderBy('updatedAt')"));
  assert.ok(client.includes('normalizeAudit(response.data?.audit)'));
  assert.ok(component.includes("scope: 'PAGE_ONLY'"));
  assert.ok(template.includes('Auditoria das páginas consultadas'));
  assert.ok(template.includes('não atesta a prioridade global'));
});

test('c18c keeps production ID cursors while staging indexed severity projection', () => {
  const index = JSON.parse(readFileSync(resolve(root, '../firestore.indexes.json'), 'utf8'));
  assert.ok(index.indexes.some((entry: {
    collectionGroup: string; fields: Array<{ fieldPath: string; order?: string }>;
  }) => entry.collectionGroup === 'media_video_processing_jobs' &&
    entry.fields.map(f => f.fieldPath).join(',') ===
      'adminTriageTier,adminTriageSince,__name__' &&
    entry.fields.every(f => f.order === 'ASCENDING')));
  assert.ok(handler.includes('items.sort(compareAdminTriageJobs)'));
  assert.ok(handler.includes('orderBy(FieldPath.documentId())'));
  assert.ok(!handler.includes("orderBy('adminTriageTier')"));
  assert.ok(handler.includes('query.startAfter(cursor[state])'));
  assert.ok(!handler.includes('items: items.slice(0, limit)'));
});


test('c18d writes triage projections with existing job writes, not in a global query', () => {
  const read = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  for (const name of [
    'video-processing-reconciliation.firestore.ts',
    'video-processing-terminal-commit.firestore.ts',
    'video-processing.handler.ts', 'queue-video-processing.handler.ts',
    'admin-video-processing-recovery.handler.ts',
    'video-source-probe.service.ts', 'video-immutable-input-preflight.service.ts',
    'emulator-video-processing.service.ts', 'delete-profile-video.handler.ts',
  ]) assert.ok(read(name).includes('withAdminTriageProjection('), name);
  assert.ok(read('admin-video-triage.firestore.ts').includes('FieldValue.delete()'));
  assert.ok(handler.includes('orderBy(FieldPath.documentId())'));
  assert.ok(!handler.includes("orderBy('adminTriageTier')"));
});


test('c18e backfill remains manual, page-bounded and never enables global order', () => {
  const read = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  const backfill = read('admin-video-triage-backfill.firestore.ts');
  assert.ok(backfill.includes('VIDEO_TRIAGE_BACKFILL_MAX_PAGE = 20'));
  assert.ok(backfill.includes("mode = request.mode ?? 'DRY_RUN'"));
  assert.ok(backfill.includes('orderBy(FieldPath.documentId())'));
  assert.ok(backfill.includes('query.limit(limit + 1).get()'));
  assert.ok(backfill.includes('current.updateTime.isEqual(observed.updateTime)'));
  assert.ok(backfill.includes('transaction.update(current.ref, withAdminTriageProjection('));
  assert.ok(!backfill.includes('onSchedule('));
  assert.ok(!backfill.includes('onCall('));
  assert.ok(!backfill.includes("orderBy('adminTriageTier')"));
  assert.ok(handler.includes("orderScope: 'WITHIN_PAGE'"));
});


test('c18f due time read is offline and index driven, with no global promotion', () => {
  const read = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  const triage = read('admin-video-triage-consistency.firestore.ts');
  assert.ok(triage.includes("mode = request.mode ?? 'DRY_RUN'"));
  assert.ok(triage.includes("where('adminTriageReevaluateAt', '>', 0)"));
  assert.ok(triage.includes("where('adminTriageReevaluateAt', '<=', now)"));
  assert.ok(triage.includes("orderBy('adminTriageReevaluateAt')"));
  assert.ok(triage.includes('query.limit(limit + 1).get()'));
  assert.ok(triage.includes('applyObservedVideoTriageBackfillJob(db, doc, now)'));
  assert.ok(triage.includes('provesGlobalCoverage: false'));
  assert.ok(!triage.includes('onCall('));
  assert.ok(!triage.includes('onSchedule('));
  assert.ok(!handler.includes("orderBy('adminTriageTier')"));
  const index = JSON.parse(readFileSync(resolve(root,
    '../firestore.indexes.json'), 'utf8'));
  assert.ok(index.indexes.some((item: {
    collectionGroup: string; fields: Array<{ fieldPath: string; order: string }>;
  }) => item.collectionGroup === 'media_video_processing_jobs' &&
    item.fields.map(f => f.fieldPath).join(',') ===
    'adminTriageReevaluateAt,__name__' &&
    item.fields.every(f => f.order === 'ASCENDING')));
});


test('c18g readiness is offline fail-closed and never promotes production ordering', () => {
  const read = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  const gate = read('admin-video-triage-readiness.policy.ts');
  const probe = read('admin-video-triage-readiness.firestore.ts');
  assert.ok(gate.includes('activationAuthorized: false'));
  assert.ok(gate.includes('globalOrderingEnabled: false'));
  assert.ok(gate.includes('FIRESTORE_ADMIN_API'));
  assert.ok(gate.includes('GLOBAL_CONSISTENT'));
  assert.ok(probe.includes("mode: 'DRY_RUN'"));
  assert.ok(probe.includes('provesGlobalCoverage: false'));
  assert.ok(!probe.includes('onSchedule('));
  assert.ok(!probe.includes('onCall('));
  assert.ok(!handler.includes("orderBy('adminTriageTier')"));
  assert.ok(handler.includes("orderScope: 'WITHIN_PAGE'"));
});


test('c18h authenticated index evidence has explicit approval, fixed REST URL and no global activation', () => {
  const read = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  const evidence = read('admin-video-triage-evidence.firestore.ts');
  const audit = read('admin-video-triage-evidence-audit.firestore.ts');
  assert.ok(evidence.includes('approval.expectedProjectId !== project'));
  assert.ok(evidence.includes('app.options.credential.getAccessToken()'));
  assert.ok(evidence.includes('https://firestore.googleapis.com/v1/'));
  assert.ok(evidence.includes("method: 'GET'"));
  assert.ok(evidence.includes("redirect: 'error'"));
  assert.ok(evidence.includes('maxDocumentReads: 0, maxWrites: 0'));
  assert.ok(audit.includes("consistency: 'BEST_EFFORT_NOT_SNAPSHOT'"));
  assert.ok(audit.includes('concurrentCursorSafetyVerified: false'));
  assert.ok(audit.includes('maxWrites: 0, provesGlobalCoverage: false'));
  assert.ok(!evidence.includes('onSchedule('));
  assert.ok(!evidence.includes('onCall('));
  assert.ok(!handler.includes("orderBy('adminTriageTier')"));
  assert.ok(handler.includes("orderScope: 'WITHIN_PAGE'"));
});


test('c18i offline audit session cannot activate ordering or gain production reachability', () => {
  const read = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  const policy = read('admin-video-triage-audit-session.policy.ts');
  const runner = read('admin-video-triage-audit-session.firestore.ts');
  assert.ok(policy.includes('createHmac('));
  assert.ok(policy.includes('timingSafeEqual('));
  assert.ok(policy.includes('globalOrderingEnabled: false'));
  assert.ok(policy.includes('globalCoverageVerified: false'));
  assert.ok(runner.includes('process.env.FIRESTORE_EMULATOR_HOST'));
  assert.ok(runner.includes('app.options.projectId !== approval.expectedProjectId'));
  assert.ok(runner.includes('getFirestore(app) !== db'));
  assert.ok(runner.includes('db.databaseId !== approval.expectedDatabaseId'));
  assert.ok(runner.includes('readPage(db, {'));
  assert.ok(!runner.includes('onSchedule('));
  assert.ok(!runner.includes('onCall('));
  assert.ok(!handler.includes("orderBy('adminTriageTier')"));
  assert.ok(handler.includes("orderScope: 'WITHIN_PAGE'"));
});


test('c18j journal reserves before read and requires generation + fence to settle', () => {
  const read = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  const journal = read('admin-video-triage-audit-journal.firestore.ts');
  const policy = read('admin-video-triage-audit-session.policy.ts');
  assert.ok(journal.includes('ledger.reservedDocumentReads += cost'));
  assert.ok(journal.includes('tx.update(ref, {'));
  assert.ok(journal.includes('active.attemptId !== claim.fence'));
  assert.ok(journal.includes('entry.generation !== claim.generation'));
  assert.ok(journal.includes('VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS = 2'));
  assert.ok(journal.includes('auditVideoTriageConcurrentPage'));
  assert.ok(journal.includes('getFirestore(app) !== db'));
  assert.ok(policy.includes('reservationAlreadyCharged'));
  assert.ok(!journal.includes('onSchedule('));
  assert.ok(!journal.includes('onCall('));
  assert.ok(!handler.includes("orderBy('adminTriageTier')"));
  assert.ok(handler.includes("orderScope: 'WITHIN_PAGE'"));
});


test('c18j triage journal source changes trigger the isolated reconciliation CI', () => {
  const workflow = readFileSync(resolve(root,
    '../.github/workflows/video-processing-reconciliation-emulator.yml'),
  'utf8');
  assert.ok(workflow.includes(
    'functions/src/media/application/admin-video-triage-*'));
});
