import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
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
  const journal = read('admin-video-triage-audit-journal.firestore.ts');
  assert.ok(runner.includes('runOneDurableVideoTriageAuditPage('));
  assert.ok(!runner.includes('readPage(db, {'));
  assert.ok(journal.includes('process.env.FIRESTORE_EMULATOR_HOST'));
  assert.ok(journal.includes('app.options.projectId !== approval.expectedProjectId'));
  assert.ok(journal.includes('getFirestore(app) !== db'));
  assert.ok(journal.includes("db.databaseId !== '(default)'"));
  assert.ok(journal.includes('readPage(db, {'));
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


/**
 * c18o source-only census. The contract checks the repository's known
 * collection bindings, not an authenticated change feed or Firestore history.
 * Unknown bindings fail CI until manually classified; direct reference
 * aliases are covered by explicit mutation-site checks below.
 */
const VIDEO_TRIAGE_JOB_COLLECTION_BINDINGS = [
  'account_lifecycle/account-owned-media-deletion.firestore.ts',
  'media/application/admin-video-processing-recovery.handler.ts',
  'media/application/admin-video-processing-status.handler.ts',
  'media/application/admin-video-triage-backfill.firestore.ts',
  'media/application/admin-video-triage-consistency.firestore.ts',
  'media/application/admin-video-triage-evidence-audit.firestore.ts',
  'media/application/admin-video-triage-evidence.firestore.ts',
  'media/application/admin-video-triage-mutation-outbox.firestore.ts',
  'media/application/admin-video-triage-readiness.policy.ts',
  'media/application/cleanup-published-video-originals.handler.ts',
  'media/application/cleanup-video-rotation-input.handler.ts',
  'media/application/delete-profile-video.handler.ts',
  'media/application/google-video-transcoder.service.ts',
  'media/application/queue-video-processing.handler.ts',
  'media/application/video-processing.handler.ts',
  'media/application/video-processing-job.ts',
  'media/application/video-processing-reconciliation.firestore.ts',
  'media/application/video-profile-deletion-commit.firestore.ts',
  'media/application/video-terminal-temporary-cleanup.firestore.ts',
] as const;

function productionTypescriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) {
      files.push(...productionTypescriptFiles(path));
    } else if (item.isFile() && item.name.endsWith('.ts') &&
        !item.name.endsWith('.test.ts') &&
        !item.name.endsWith('.spec.ts')) {
      files.push(path);
    }
  }
  return files;
}

test('c18o fails closed when an unclassified production source binds the video jobs collection', () => {
  const sourceRoot = resolve(root, 'src');
  const actual = productionTypescriptFiles(sourceRoot)
    .filter(file => {
      const body = readFileSync(file, 'utf8');
      return body.includes('VIDEO_PROCESSING_JOBS_COLLECTION') ||
        body.includes('media_video_processing_jobs');
    })
    .map(file => relative(sourceRoot, file).replace(/\\/g, '/')).sort();
  const expected = [...VIDEO_TRIAGE_JOB_COLLECTION_BINDINGS].sort();
  assert.deepEqual(actual, expected,
    'Video job collection reference inventory changed: inspect and classify every new source.');
});

test('c18o writer provenance is not a complete atomic mutation feed', () => {
  const read = (name: string) => readFileSync(
    resolve(root, 'src/' + name), 'utf8');
  const required: Array<[string, readonly string[]]> = [
    ['media/application/queue-video-processing.handler.ts', [
      'transaction.create(jobRef, withAdminTriageProjection(',
      'transaction.set(',
    ]],
    ['media/application/video-processing.handler.ts', [
      'transaction.update(jobRef, withAdminTriageProjection(',
    ]],
    ['media/application/video-processing-reconciliation.firestore.ts', [
      'transaction.update(jobRef, withAdminTriageProjection(',
      'transaction.delete(jobRef);',
      'stageVideoTriageMutationInTransaction(',
    ]],
    ['media/application/video-processing-terminal-commit.firestore.ts', [
      'transaction.update(jobRef, withAdminTriageProjection(',
    ]],
    ['media/application/admin-video-processing-recovery.handler.ts', [
      'transaction.set(jobRef, withAdminTriageProjection(',
    ]],
    ['media/application/admin-video-triage-backfill.firestore.ts', [
      'transaction.update(current.ref, withAdminTriageProjection(',
    ]],
    ['media/application/video-source-probe.service.ts', [
      'transaction.update(jobRef, withAdminTriageProjection(',
    ]],
    ['media/application/video-immutable-input-preflight.service.ts', [
      'transaction.update(jobRef, withAdminTriageProjection(',
    ]],
    ['media/application/emulator-video-processing.service.ts', [
      'transaction.update(jobRef, withAdminTriageProjection(',
    ]],
    ['media/application/video-profile-deletion-commit.firestore.ts', [
      'transaction.create(deletionJobRef, {',
      'transaction.set(processingJobRef, withAdminTriageProjection(',
      'stageVideoTriageMutationInTransaction(',
    ]],
    ['account_lifecycle/account-owned-media-deletion.firestore.ts', [
      'transaction.delete(jobSnapshot.ref);',
      'transaction.update(jobSnapshot.ref, withAdminTriageProjection(',
      'transaction.set(processingRef, withAdminTriageProjection(',
      'stageVideoTriageMutationInTransaction(',
    ]],
  ];
  for (const [file, markers] of required) {
    const content = read(file);
    for (const marker of markers) {
      assert.ok(content.includes(marker), file + ': missing ' + marker);
    }
  }
  // A durable triage audit journal is not a job mutation feed.
  const journal = read('media/application/admin-video-triage-audit-journal.firestore.ts');
  assert.ok(journal.includes("'media_video_triage_audit_sessions'"));
  assert.ok(!journal.includes('transaction.create(jobMutationRef'));
  const scope = read('media/application/admin-video-triage-audit-session.policy.ts');
  assert.ok(scope.includes('EMULATOR_CLOSED_EPOCH_FIXTURE_ONLY'));
  assert.ok(scope.includes('globalCoverageVerified: false'));
  const gate = read('media/application/admin-video-triage-readiness.policy.ts');
  assert.ok(gate.includes("coverage.scope === 'GLOBAL_CONSISTENT'"));
  assert.ok(gate.includes('activationAuthorized: false'));
});


test('c18p tombstones and account cancellation share Firestore transactions', () => {
  const src = (name: string) => readFileSync(
    resolve(root, 'src/' + name), 'utf8');
  const outbox = src('media/application/admin-video-triage-mutation-outbox.firestore.ts');
  const lifecycle = src('account_lifecycle/account-owned-media-deletion.firestore.ts');
  const reconciliation = src('media/application/video-processing-reconciliation.firestore.ts');

  assert.ok(outbox.includes('transaction.create(ref, {'));
  assert.ok(outbox.includes('PARTIAL_WRITER_COVERAGE'));
  assert.ok(outbox.includes('globalCoverageVerified: false'));
  assert.ok(outbox.includes('globallySequenced: false'));
  assert.ok(!outbox.includes('onSchedule('));
  assert.ok(!outbox.includes('onCall('));
  assert.ok(!outbox.includes('transcoder'));

  assert.ok(lifecycle.includes('current.updateTime.isEqual(jobSnapshot.updateTime)'));
  assert.ok(lifecycle.includes('transaction.delete(jobSnapshot.ref);'));
  assert.ok(lifecycle.includes('transaction.update(jobSnapshot.ref, withAdminTriageProjection('));
  assert.ok(lifecycle.includes('transaction.set(processingRef, withAdminTriageProjection('));
  assert.ok(!lifecycle.includes('await jobSnapshot.ref.delete();'));
  assert.ok(!lifecycle.includes('await jobSnapshot.ref.set('));
  assert.ok(!lifecycle.includes('hideBatch.set('));
  assert.equal(lifecycle.split('stageVideoTriageMutationInTransaction(').length - 1, 4);
  assert.ok(lifecycle.includes('transaction.delete(processingRef);'));
  assert.ok(!lifecycle.includes('await processingRef.delete();'));
  assert.ok(reconciliation.includes('stageVideoTriageMutationInTransaction('));
  assert.ok(!outbox.includes('globalCoverageVerified: true'));
});


test('c18p account-owned video job writes trigger isolated Firestore reconciliation', () => {
  const workflow = readFileSync(resolve(root,
    '../.github/workflows/video-processing-reconciliation-emulator.yml'), 'utf8');
  assert.ok(workflow.includes(
    "'functions/src/account_lifecycle/account-owned-media-deletion.firestore.ts'"));
  assert.ok(workflow.includes(
    "'.github/workflows/video-processing-reconciliation-emulator.yml'"));
  assert.ok(workflow.includes(
    "'functions/src/media/application/admin-video-triage-*'"));
});


test('c18q queue, submission and terminal writers stage partial mutation events in the same transaction', () => {
  const read = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  const queue = read('queue-video-processing.handler.ts');
  const submit = read('video-processing.handler.ts');
  const terminal = read('video-processing-terminal-commit.firestore.ts');
  const outbox = read('admin-video-triage-mutation-outbox.firestore.ts');

  assert.ok(queue.includes('stageVideoTriageCreatedJobInTransaction('));
  assert.ok(queue.includes('transaction.create(jobRef, withAdminTriageProjection('));
  assert.ok(queue.includes("source: 'SUBMISSION_CLAIM'"));
  assert.ok(submit.includes("source: 'SUBMISSION_CLAIM'"));
  assert.ok(submit.includes("source: 'SUBMISSION_CONFIRMATION'"));
  assert.ok(terminal.includes("source: 'TERMINAL_COMMIT'"));
  assert.ok(terminal.includes("kind: 'STATE_TRANSITION'"));
  assert.ok(terminal.includes("kind: 'CANCEL_REQUESTED'"));
  assert.ok(outbox.includes("kind: 'CREATE'"));
  assert.ok(outbox.includes('before.exists || before.ref.path !== jobRef.path'));
  assert.ok(outbox.includes('globallySequenced: false'));
  assert.ok(outbox.includes('globalCoverageVerified: false'));
  assert.ok(!outbox.includes('globalCoverageVerified: true'));
  assert.ok(!handler.includes("orderBy('adminTriageTier')"));
});


test('c18r administrative replacement and recovery only journal actual transitions', () => {
  const read = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  const admin = read('admin-video-processing-recovery.handler.ts');
  const recovery = read('video-processing-reconciliation.firestore.ts');
  const outbox = read('admin-video-triage-mutation-outbox.firestore.ts');
  const retry = admin.slice(admin.indexOf('async function retryFailedJob('),
    admin.indexOf('async function mutateExistingJob('));
  const existing = admin.slice(admin.indexOf('async function mutateExistingJob('));

  assert.ok(retry.includes("kind: 'VERSION_REPLACED'"));
  assert.ok(retry.includes('nextProcessingVersion: retryJob.processingVersion'));
  assert.ok(retry.includes('eventId: mutationEventId'));
  assert.ok(retry.includes('currentJob.lastAdminOperationId === command.operationId'));
  assert.ok(existing.includes('if (nextState !== state)'));
  assert.ok(existing.includes("source: 'ADMIN_RECOVERY'"));
  assert.ok(recovery.includes("source: 'SUBMISSION_RECOVERY'"));
  assert.ok(recovery.includes("if (typeof nextState === 'string' && nextState !== current?.state)"));
  assert.ok(outbox.includes('nextProcessingVersion: intent.nextProcessingVersion'));
  assert.ok(outbox.includes('globallySequenced: false'));
  assert.ok(!outbox.includes('globalCoverageVerified: true'));
});


test('c18s probe and immutable input preflight journal only terminal state changes', () => {
  const src = (name: string) => readFileSync(resolve(root,
    'src/media/application/' + name), 'utf8');
  const probe = src('video-source-probe.service.ts');
  const preflight = src('video-immutable-input-preflight.service.ts');
  const backfill = src('admin-video-triage-backfill.firestore.ts');
  const outbox = src('admin-video-triage-mutation-outbox.firestore.ts');

  for (const body of [probe, preflight]) {
    assert.equal(
      body.split('stageVideoTriageMutationInTransaction(').length - 1, 3);
    assert.ok(body.includes('kind: \'CANCEL_REQUESTED\''));
    assert.ok(body.includes('kind: sourceChanged ? \'CANCEL_REQUESTED\'') ||
      body.includes('kind: changed ? \'CANCEL_REQUESTED\''));
    assert.ok(body.includes("afterState: 'CANCEL_REQUESTED'"));
    assert.ok(body.includes('afterState: sourceChanged ?') ||
      body.includes('afterState: status'));
    assert.ok(body.includes('const initialMutationEventId = randomUUID();'));
    assert.ok(body.includes('const completionMutationEventId = randomUUID();'));
    assert.ok(body.includes('const failureMutationEventId = randomUUID();'));
  }
  assert.ok(outbox.includes("'SOURCE_PROBE'"));
  assert.ok(outbox.includes("'IMMUTABLE_PREFLIGHT'"));
  assert.ok(!backfill.includes('stageVideoTriageMutationInTransaction('));
  assert.ok(backfill.includes('current.updateTime.isEqual(observed.updateTime)'));
  assert.ok(backfill.includes("return required === 'PROJECT'"));
  assert.ok(!outbox.includes('globalCoverageVerified: true'));
  assert.ok(!outbox.includes('globallySequenced: true'));
});


test('c18t outbox diagnostic is non-destructive and does not grant global readiness', () => {
  const outbox = readFileSync(resolve(root,
    'src/media/application/admin-video-triage-mutation-outbox.firestore.ts'), 'utf8');
  assert.ok(outbox.includes('assessVideoTriageOutboxCostWindow('));
  assert.ok(outbox.includes('assessVideoTriageOutboxRetentionPrerequisites('));
  assert.ok(outbox.includes('cleanupAuthorized: false'));
  assert.ok(outbox.includes('productionCostVerified: false'));
  assert.ok(outbox.includes('globalCoverageVerified: false'));
  assert.ok(!outbox.includes('transaction.delete(ref)'));
  assert.ok(!outbox.includes('deleteAll('));
  assert.ok(!outbox.includes('onSchedule('));
  assert.ok(!outbox.includes('ttlPolicy'));
  assert.ok(outbox.includes('VIDEO_TRIAGE_MUTATION_OUTBOX_SCHEMA_VERSION'));
});

test('c18u local emulator terminal transitions share the outbox transaction', () => {
  const emu = readFileSync(resolve(root,
    'src/media/application/emulator-video-processing.service.ts'), 'utf8');
  const outbox = readFileSync(resolve(root,
    'src/media/application/admin-video-triage-mutation-outbox.firestore.ts'), 'utf8');
  assert.equal(
    emu.split('stageVideoTriageMutationInTransaction(').length - 1, 2);
  assert.equal(
    emu.split("source: 'EMULATOR_PROCESSING'").length - 1, 2);
  assert.equal(
    emu.split("jobSnapshot.get('processingVersion') !== job.processingVersion")
      .length - 1, 2);
  assert.ok(emu.includes("afterState: 'FAILED'"));
  assert.ok(emu.includes("afterState: 'SUCCEEDED'"));
  assert.ok(emu.includes('const mutationEventId = randomUUID();'));
  assert.ok(outbox.includes("'EMULATOR_PROCESSING'"));
  assert.ok(!outbox.includes('globalCoverageVerified: true'));
});

test('c18v deletion is one fenced transaction, never a stale WriteBatch', () => {
  const read = (file: string) => readFileSync(resolve(root,
    'src/media/application/' + file), 'utf8');
  const handler = read('delete-profile-video.handler.ts');
  const commit = read('video-profile-deletion-commit.firestore.ts');
  const identity = read('video-identity-guard.firestore.ts');
  const outbox = read('admin-video-triage-mutation-outbox.firestore.ts');
  assert.ok(handler.includes('await commitProfileVideoDeletionRequest(db, {'));
  assert.ok(handler.includes('buildJob: ({ privateVideo, publication, processingJob }'));
  assert.ok(!handler.includes('removalBatch.commit()'));
  assert.ok(!handler.includes('requestProcessingCancellation('));
  assert.ok(commit.includes('return firestore.runTransaction(async transaction => {'));
  assert.ok(commit.includes('transaction.get(processingJobRef)'));
  assert.ok(commit.includes('transaction.get(identityRef)'));
  assert.ok(commit.includes('transaction.get(publicationRef)'));
  assert.ok(commit.includes('transaction.create(deletionJobRef, {'));
  assert.ok(commit.includes('retireVideoIdentityInTransaction('));
  assert.ok(commit.includes('stageVideoTriageMutationInTransaction('));
  assert.ok(commit.includes("source: 'PROFILE_VIDEO_DELETION'"));
  assert.ok(commit.includes("state !== 'CANCEL_REQUESTED' && state !== 'CANCELLED'"));
  assert.ok(commit.includes('lastUpdateTime: publication.updateTime'));
  assert.ok(identity.includes('export function retireVideoIdentityInTransaction('));
  assert.ok(identity.includes('lastUpdateTime: identitySnapshot.updateTime'));
  assert.ok(outbox.includes("'PROFILE_VIDEO_DELETION'"));
  assert.ok(!outbox.includes('globalCoverageVerified: true'));
});

test('c18u Functions dependency changes retrigger isolated reconciliation', () => {
  const workflow = readFileSync(resolve(root,
    '../.github/workflows/video-processing-reconciliation-emulator.yml'),
  'utf8');
  assert.ok(workflow.includes("'functions/package.json'"));
  assert.ok(workflow.includes("'functions/package-lock.json'"));
});
