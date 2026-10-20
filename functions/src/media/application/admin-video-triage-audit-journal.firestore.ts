/**
 * c18j durable, emulator-only audit session journal.
 *
 * Every phase is a bounded Firestore transaction against a separate audit
 * collection. No job document is written. Claim RESERVES the query budget
 * before returning permission to read. Generation and random fencing token
 * gate settlement. Expired claims are charged as failures before take-over.
 *
 * This is NOT exported from Functions and does not enable production access,
 * autonomous retries, scheduling, migration or global ordering.
 */
import { createHash, randomUUID } from 'node:crypto';

import type { App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import {
  auditVideoTriageConcurrentPage,
  type VideoTriageConcurrentAuditPage,
} from './admin-video-triage-evidence-audit.firestore';
import {
  openVideoTriageAuditCheckpoint,
  reportVideoTriageAudit, sealVideoTriageAuditCheckpoint,
  settleVideoTriageAuditPage, videoTriageAuditCanRead,
  type VideoTriageAuditApproval,
  type VideoTriageAuditLedger, type VideoTriageAuditReport,
} from './admin-video-triage-audit-session.policy';

export const VIDEO_TRIAGE_AUDIT_JOURNAL_COLLECTION =
  'media_video_triage_audit_sessions';
export const VIDEO_TRIAGE_AUDIT_LEASE_MS = 60_000;
export const VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS = 2;
/**
 * c18m SDK-call instrumentation. Events count call attempts, not billable
 * Firestore operations. Opt-in and emulator-only; no IDs or tokens emitted.
 */
export type VideoTriageAuditSdkEvent =
  'TX_ATTEMPT' | 'TX_GET' | 'TX_WRITE' | 'DIRECT_GET';
export type VideoTriageAuditSdkObserver =
  (event: VideoTriageAuditSdkEvent) => void;

export const VIDEO_TRIAGE_AUDIT_MAX_CLOCK_SKEW_MS = 120_000;
// One bounded read and write per transaction attempt, plus one recovery read.
export const VIDEO_TRIAGE_JOURNAL_OPERATIONS_PER_PAGE =
  4 * VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS + 1;

interface AuditAttemptReceipt {
  attemptId: string;
  ownerId: string;
  generation: number;
  outcome: 'APPLIED' | 'ABANDONED';
  evidenceDigest: string | null;
  resultId: string | null;
  resolvedAt: number;
}


interface ActiveAuditLease {
  attemptId: string;
  ownerId: string;
  generation: number;
  claimedAt: number;
  until: number;
  lane: string;
  afterId: string | null;
}

interface DurableAuditSession {
  schemaVersion: 2;
  projectId: string;
  databaseId: '(default)';
  sessionId: string;
  checkpointDigest: string;
  generation: number;
  ledger: VideoTriageAuditLedger;
  active: ActiveAuditLease | null;
  /** Maximum 100 receipts, bounded by the session's maxPages. */
  receipts: Record<string, AuditAttemptReceipt>;
  journalReservedOperations: number;
  maxJournalOperations: number;
}

export interface VideoTriageAuditClaim {
  sessionId: string;
  generation: number;
  attemptId: string;
  ownerId: string;
  fence: string;
  checkpoint: string;
  lane: string;
  afterId: string | null;
  evaluationAt: number;
  pageSize: number;
}

export type VideoTriageAuditClaimOutcome =
  | { kind: 'CLAIMED'; claim: VideoTriageAuditClaim }
  | { kind: 'BUSY' | 'STALE_CHECKPOINT' | 'STOPPED'; report: VideoTriageAuditReport };

export type VideoTriageAuditSettlement =
  | { kind: 'APPLIED'; checkpoint: string; report: VideoTriageAuditReport }
  | { kind: 'SUPERSEDED' | 'DUPLICATE'; report: VideoTriageAuditReport };

export interface VideoTriageJournalStep {
  kind: 'STOPPED' | 'BUSY' | 'STALE_CHECKPOINT' |
    'APPLIED' | 'SUPERSEDED' | 'DUPLICATE' | 'NOT_APPLIED' | 'INCONCLUSIVE';
  checkpoint?: string;
  report: VideoTriageAuditReport;
  readFailed: boolean;
  page: VideoTriageConcurrentAuditPage | null;
}

/** The SDK must be bound to the explicitly named local emulator project. */
function guard(
  db: Firestore, app: App, approval: VideoTriageAuditApproval
): string {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (typeof host !== 'string' ||
      !/^127\.0\.0\.1:\d{2,5}$/.test(host) ||
      !approval || approval.approved !== true ||
      approval.purpose !== 'MANUAL_EMULATOR_TRIAGE_AUDIT' ||
      approval.expectedDatabaseId !== '(default)' ||
      typeof approval.expectedSessionId !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(approval.expectedSessionId) ||
      app.options.projectId !== approval.expectedProjectId ||
      getFirestore(app) !== db || db.databaseId !== '(default)') {
    throw new Error('Durable audit is restricted to an authorized local emulator.');
  }
  return approval.expectedSessionId;
}

function digest(checkpoint: string): string {
  return createHash('sha256').update(checkpoint, 'utf8').digest('hex');
}

function checkedClock(now: number): number {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new RangeError('Durable audit requires a valid clock.');
  }
  return now;
}

function transactionalClock(
  readTime: { toMillis(): number }, supplied: number, lastStepAt: number
): number {
  const serverNow = checkedClock(readTime.toMillis());
  if (Math.abs(serverNow - supplied) > VIDEO_TRIAGE_AUDIT_MAX_CLOCK_SKEW_MS ||
      serverNow < lastStepAt) {
    throw new Error('Audit journal clock skew or regression.');
  }
  return serverNow;
}

function receiptFor(
  lease: ActiveAuditLease, outcome: AuditAttemptReceipt['outcome'],
  at: number, evidenceDigest: string | null = null
): AuditAttemptReceipt {
  return {
    attemptId: lease.attemptId, ownerId: lease.ownerId,
    generation: lease.generation, outcome, evidenceDigest,
    resultId: outcome === 'APPLIED' ?
      digest(JSON.stringify({
        attemptId: lease.attemptId, generation: lease.generation,
        evidenceDigest,
      })) : null,
    resolvedAt: at,
  };
}

function sameAttempt(
  receipt: AuditAttemptReceipt, claim: VideoTriageAuditClaim
): boolean {
  return receipt.attemptId === claim.attemptId &&
    receipt.ownerId === claim.ownerId &&
    receipt.generation === claim.generation &&
    claim.fence === claim.attemptId;
}

function readDocument(
  data: unknown, approval: VideoTriageAuditApproval,
  key: Buffer
): DurableAuditSession {
  const entry = data as DurableAuditSession | null;
  if (!entry || entry.schemaVersion !== 2 ||
      entry.projectId !== approval.expectedProjectId ||
      entry.databaseId !== approval.expectedDatabaseId ||
      entry.sessionId !== approval.expectedSessionId ||
      !Number.isSafeInteger(entry.generation) || entry.generation < 0 ||
      !entry.receipts || typeof entry.receipts !== 'object' ||
      !Number.isSafeInteger(entry.journalReservedOperations) ||
      !Number.isSafeInteger(entry.maxJournalOperations) ||
      entry.journalReservedOperations < 0 ||
      entry.journalReservedOperations > entry.maxJournalOperations ||
      entry.maxJournalOperations !== entry.ledger?.budget?.maxPages *
        VIDEO_TRIAGE_JOURNAL_OPERATIONS_PER_PAGE ||
      Object.keys(entry.receipts).length > entry.ledger.budget.maxPages) {
    throw new Error('Audit journal identity mismatch.');
  }
  const token = sealVideoTriageAuditCheckpoint(entry.ledger, key);
  openVideoTriageAuditCheckpoint(token, key, approval);
  if (entry.checkpointDigest !== digest(token)) {
    throw new Error('Audit journal checkpoint integrity failure.');
  }
  return entry;
}

function refFor(db: Firestore, id: string) {
  return db.collection(VIDEO_TRIAGE_AUDIT_JOURNAL_COLLECTION).doc(id);
}

/** Registration is explicit; never silently creates a record from a replay. */
/**
 * Explicit registration from c18i's issued signed checkpoint; no additional
 * random session is generated. This is the supported c18i -> c18j bridge.
 */
export async function registerSignedVideoTriageAuditJournal(
  db: Firestore, app: App, approval: VideoTriageAuditApproval,
  checkpoint: string, key: Buffer,
  observer?: VideoTriageAuditSdkObserver
): Promise<VideoTriageAuditReport> {
  const id = guard(db, app, approval);
  const ledger = openVideoTriageAuditCheckpoint(checkpoint, key, approval);
  if (ledger.sessionId !== id || ledger.pagesAttempted !== 0 ||
      ledger.pagesCompleted !== 0 || ledger.reservedDocumentReads !== 0) {
    throw new Error('Durable journal requires a pristine signed session.');
  }
  await db.runTransaction(async tx => {
    observer?.('TX_ATTEMPT');
    const ref = refFor(db, id);
    observer?.('TX_GET');
    if ((await tx.get(ref)).exists) {
      throw new Error('Audit session is already registered.');
    }
    const record: DurableAuditSession = {
      schemaVersion: 2, projectId: ledger.projectId,
      databaseId: '(default)', sessionId: id,
      checkpointDigest: digest(checkpoint), generation: 0,
      ledger, active: null, receipts: {},
      journalReservedOperations: 0,
      maxJournalOperations: ledger.budget.maxPages *
        VIDEO_TRIAGE_JOURNAL_OPERATIONS_PER_PAGE,
    };
    observer?.('TX_WRITE');
    tx.create(ref, record);
  }, { maxAttempts: VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS });
  return reportVideoTriageAudit(ledger);
}

/** Read-only recovery of the canonical checkpoint; no job reads. */
export async function readDurableVideoTriageAuditJournal(
  db: Firestore, app: App, approval: VideoTriageAuditApproval,
  key: Buffer, observer?: VideoTriageAuditSdkObserver
): Promise<{ checkpoint: string; report: VideoTriageAuditReport;
  generation: number; inFlight: boolean; journalReservedOperations: number }> {
  const id = guard(db, app, approval);
  observer?.('DIRECT_GET');
  const doc = await refFor(db, id).get();
  if (!doc.exists) throw new Error('Audit journal not registered.');
  const entry = readDocument(doc.data(), approval, key);
  return {
    checkpoint: sealVideoTriageAuditCheckpoint(entry.ledger, key),
    report: reportVideoTriageAudit(entry.ledger),
    generation: entry.generation, inFlight: !!entry.active,
    journalReservedOperations: entry.journalReservedOperations,
  };
}

export type VideoTriageAuditRecovery =
  | { kind: 'APPLIED'; resultId: string; checkpoint: string; report: VideoTriageAuditReport }
  | { kind: 'NOT_APPLIED' | 'SUPERSEDED' | 'INCONCLUSIVE';
      checkpoint: string; report: VideoTriageAuditReport };

/** Recovery never queries jobs, and never credits a counter. */
export async function recoverDurableVideoTriageAuditAttempt(
  db: Firestore, app: App, approval: VideoTriageAuditApproval,
  key: Buffer, claim: VideoTriageAuditClaim,
  observer?: VideoTriageAuditSdkObserver
): Promise<VideoTriageAuditRecovery> {
  const id = guard(db, app, approval);
  if (claim.sessionId !== id || claim.fence !== claim.attemptId) {
    throw new Error('Audit attempt recovery identity mismatch.');
  }
  observer?.('DIRECT_GET');
  const doc = await refFor(db, id).get();
  if (!doc.exists) throw new Error('Audit journal missing.');
  const entry = readDocument(doc.data(), approval, key);
  const checkpoint = sealVideoTriageAuditCheckpoint(entry.ledger, key);
  const report = reportVideoTriageAudit(entry.ledger);
  const receipt = entry.receipts[claim.attemptId];
  if (receipt) {
    if (!sameAttempt(receipt, claim)) {
      return { kind: 'SUPERSEDED', checkpoint, report };
    }
    if (receipt.outcome === 'APPLIED' && receipt.resultId) {
      return { kind: 'APPLIED', resultId: receipt.resultId, checkpoint, report };
    }
    return { kind: 'NOT_APPLIED', checkpoint, report };
  }
  if (entry.active?.attemptId === claim.attemptId &&
      entry.active.ownerId === claim.ownerId &&
      entry.active.generation === claim.generation) {
    return { kind: 'INCONCLUSIVE', checkpoint, report };
  }
  return { kind: entry.generation > claim.generation ?
    'SUPERSEDED' : 'INCONCLUSIVE', checkpoint, report };
}

/**
 * Reserves before any job read. Competing transactions serialize on the
 * session document. An abandoned lease is counted once as an attempted
 * failed page and never credits cursor/projection counts.
 */
export async function claimDurableVideoTriageAuditPage(
  db: Firestore, app: App, approval: VideoTriageAuditApproval,
  expectedCheckpoint: string, key: Buffer,
  ownerId: string, now: number,
  observer?: VideoTriageAuditSdkObserver
): Promise<VideoTriageAuditClaimOutcome> {
  const id = guard(db, app, approval);
  checkedClock(now);
  if (!/^[0-9a-f-]{36}$/.test(ownerId)) {
    throw new Error('Invalid audit executor identity.');
  }
  const submitted = openVideoTriageAuditCheckpoint(
    expectedCheckpoint, key, approval);
  if (submitted.sessionId !== id) throw new Error('Audit checkpoint session mismatch.');

  return db.runTransaction(async tx => {
    observer?.('TX_ATTEMPT');
    const ref = refFor(db, id);
    observer?.('TX_GET');
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error('Audit journal not registered.');
    const entry = readDocument(doc.data(), approval, key);
    const at = transactionalClock(doc.readTime, now, entry.ledger.lastStepAt);
    if (entry.checkpointDigest !== digest(expectedCheckpoint)) {
      return { kind: 'STALE_CHECKPOINT' as const,
        report: reportVideoTriageAudit(entry.ledger) };
    }
    if (entry.active && entry.active.until > at) {
      return { kind: 'BUSY' as const,
        report: reportVideoTriageAudit(entry.ledger) };
    }

    const ledger = structuredClone(entry.ledger);
    const receipts = { ...entry.receipts };
    if (entry.active) {
      ledger.failedPages++;
      ledger.consecutiveFailures++;
      ledger.lastReadFailed = true;
      ledger.lastStepAt = at;
      receipts[entry.active.attemptId] =
        receiptFor(entry.active, 'ABANDONED', at);
      ledger.status = ledger.failedPages > ledger.budget.maxFailures ?
        'STOPPED_BUDGET' : 'PAUSED_FAILURE';
    }
    const permission = videoTriageAuditCanRead(ledger, at);
    if (!permission.allowed) {
      ledger.status = permission.reason === 'EXPIRED' ? 'EXPIRED' :
        permission.reason === 'STOPPED_BUDGET' ? 'STOPPED_BUDGET' :
          ledger.status;
      const updated = sealVideoTriageAuditCheckpoint(ledger, key);
      observer?.('TX_WRITE');
      tx.update(ref, {
        ledger, checkpointDigest: digest(updated), active: null, receipts,
        generation: entry.active ? entry.generation + 1 : entry.generation,
      });
      return { kind: 'STOPPED' as const,
        report: reportVideoTriageAudit(ledger) };
    }

    // Reserve the complete upper bound before the query can execute.
    if (entry.journalReservedOperations +
          VIDEO_TRIAGE_JOURNAL_OPERATIONS_PER_PAGE >
          entry.maxJournalOperations) {
      return { kind: 'STOPPED' as const,
        report: reportVideoTriageAudit(entry.ledger) };
    }
    const cost = 2 * ledger.budget.pageSize + 1;
    ledger.pagesAttempted++;
    ledger.reservedDocumentReads += cost;
    ledger.lastStepAt = at;
    ledger.status = 'OPEN';
    ledger.lastReadFailed = false;
    const generation = entry.generation + 1;
    const lease: ActiveAuditLease = {
      ownerId, attemptId: randomUUID(), generation,
      claimedAt: at, until: Math.min(
        at + VIDEO_TRIAGE_AUDIT_LEASE_MS,
        ledger.createdAt + ledger.budget.maxDurationMs),
      lane: ledger.lanes[ledger.nextLaneIndex].state,
      afterId: ledger.lanes[ledger.nextLaneIndex].afterId,
    };
    const checkpoint = sealVideoTriageAuditCheckpoint(ledger, key);
    observer?.('TX_WRITE');
    tx.update(ref, {
      ledger, checkpointDigest: digest(checkpoint),
      active: lease, generation, receipts,
      journalReservedOperations: entry.journalReservedOperations +
        VIDEO_TRIAGE_JOURNAL_OPERATIONS_PER_PAGE,
    });
    return { kind: 'CLAIMED' as const, claim: {
      sessionId: id, generation, attemptId: lease.attemptId,
      ownerId, fence: lease.attemptId, checkpoint,
      lane: lease.lane, afterId: lease.afterId,
      evaluationAt: ledger.evaluationAt,
      pageSize: ledger.budget.pageSize,
    } };
  }, { maxAttempts: VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS });
}

/** Reject stale generation/owner; never persist a result twice. */
export async function settleDurableVideoTriageAuditPage(
  db: Firestore, app: App, approval: VideoTriageAuditApproval,
  key: Buffer, claim: VideoTriageAuditClaim,
  page: VideoTriageConcurrentAuditPage | null, now: number,
  observer?: VideoTriageAuditSdkObserver
): Promise<VideoTriageAuditSettlement> {
  const id = guard(db, app, approval);
  checkedClock(now);
  if (claim.sessionId !== id) throw new Error('Audit settlement session mismatch.');
  return db.runTransaction(async tx => {
    observer?.('TX_ATTEMPT');
    const ref = refFor(db, id);
    observer?.('TX_GET');
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error('Audit journal missing.');
    const entry = readDocument(doc.data(), approval, key);
    const at = transactionalClock(doc.readTime, now, entry.ledger.lastStepAt);
    const receipt = entry.receipts[claim.attemptId];
    if (receipt) {
      return {
        kind: sameAttempt(receipt, claim) &&
          receipt.outcome === 'APPLIED' &&
          receipt.evidenceDigest === digest(JSON.stringify(page)) ?
          'DUPLICATE' as const : 'SUPERSEDED' as const,
        report: reportVideoTriageAudit(entry.ledger),
      };
    }
    const active = entry.active;
    if (!active) {
      return { kind: 'SUPERSEDED' as const,
        report: reportVideoTriageAudit(entry.ledger) };
    }
    if (entry.generation !== claim.generation ||
        active.attemptId !== claim.fence ||
        active.ownerId !== claim.ownerId ||
        active.generation !== claim.generation ||
        active.lane !== claim.lane ||
        active.afterId !== claim.afterId ||
        active.until <= at) {
      return { kind: 'SUPERSEDED' as const,
        report: reportVideoTriageAudit(entry.ledger) };
    }
    const ledger = settleVideoTriageAuditPage(
      entry.ledger, at, page, true);
    const checkpoint = sealVideoTriageAuditCheckpoint(ledger, key);
    observer?.('TX_WRITE');
    tx.update(ref, {
      ledger, checkpointDigest: digest(checkpoint), active: null,
      receipts: {
        ...entry.receipts,
        [active.attemptId]: receiptFor(
          active, 'APPLIED', at, digest(JSON.stringify(page))),
      },
    });
    return { kind: 'APPLIED' as const, checkpoint,
      report: reportVideoTriageAudit(ledger) };
  }, { maxAttempts: VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS });
}

/**
 * Executes at most one page. No retries; failures settle as a failed page.
 * Fencing rejects completions after a different executor has taken over.
 */
export async function runOneDurableVideoTriageAuditPage(
  db: Firestore, app: App, approval: VideoTriageAuditApproval,
  checkpoint: string, key: Buffer,
  clock: () => number = Date.now,
  readPage: typeof auditVideoTriageConcurrentPage = auditVideoTriageConcurrentPage,
  observer?: VideoTriageAuditSdkObserver
): Promise<VideoTriageJournalStep> {
  const owner = randomUUID();
  const claimed = await claimDurableVideoTriageAuditPage(
    db, app, approval, checkpoint, key, owner, clock(), observer);
  if (claimed.kind !== 'CLAIMED') {
    return {
      kind: claimed.kind, report: claimed.report,
      readFailed: false, page: null,
    };
  }
  let page: VideoTriageConcurrentAuditPage | null = null;
  let readFailed = false;
  try {
    page = await readPage(db, {
      state: claimed.claim.lane as VideoTriageConcurrentAuditPage['state'],
      afterId: claimed.claim.afterId, limit: claimed.claim.pageSize,
      now: claimed.claim.evaluationAt,
    });
  } catch {
    readFailed = true;
  }
  try {
    const settled = await settleDurableVideoTriageAuditPage(
      db, app, approval, key, claimed.claim, page, clock(), observer);
    return {
      ...settled, readFailed,
      page: settled.kind === 'APPLIED' ? page : null,
    };
  } catch {
    // A lost commit response is never permission to reread the jobs.
    const recovered = await recoverDurableVideoTriageAuditAttempt(
      db, app, approval, key, claimed.claim, observer);
    return {
      kind: recovered.kind === 'APPLIED' ? 'DUPLICATE' as const :
        recovered.kind,
      checkpoint: recovered.checkpoint, report: recovered.report,
      readFailed, page: null,
    };
  }
}

/** c18l offline consistency report; never authorizes a live audit. */
export interface VideoTriageAuditCostEvidence {
  /** External, explicitly bounded operator observation; never inferred. */
  source: 'EMULATOR_INSTRUMENTATION';
  jobQueryReads: number;
  jobPointReads: number;
  journalDocumentReads: number;
  journalDocumentWrites: number;
  transactionRetries: number;
  recoveryReads: number;
  statusReads: number;
  registrationOperations: number;
}

export interface VideoTriageAuditValidation {
  scope: 'OFFLINE_SESSION_ONLY';
  globalCoverageVerified: false;
  concurrentCursorSafetyVerified: false;
  productionCostVerified: false;
  globalOrderingEnabled: false;
  measuredOperationsVerified: false;
  consistency: 'CONSISTENT' | 'INCONSISTENT';
  coverage: 'CONCURRENT_CHANGES_OBSERVED' | 'NOT_PROVEN';
  cost: 'NOT_MEASURED' | 'MEASUREMENT_REVIEW' | 'INCONSISTENT';
  blockingReasons: string[];
  limits: {
    maxJobReadsPerPage: number;
    jobReadsReserved: number;
    maxJournalOperationsPerPage: number;
    journalOperationsReserved: number;
    maxJournalOperations: number;
    /** Ceiling for reservations, not actual costs or a full billing cap. */
    combinedReservationUpperBound: number;
  };
}

function whole(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Checks consistency between an HMAC-authenticated ledger and a separately
 * read journal reservation. Both are only an internal, partial audit.
 */
export function validateVideoTriageAuditSession(
  signedCheckpoint: string,
  key: Buffer,
  approval: VideoTriageAuditApproval,
  journalReservedOperations: number,
  evidence?: VideoTriageAuditCostEvidence
): VideoTriageAuditValidation {
  const ledger = openVideoTriageAuditCheckpoint(
    signedCheckpoint, key, approval);
  const { budget } = ledger;
  const maxJobReadsPerPage = 2 * budget.pageSize + 1;
  const journalPerPage = VIDEO_TRIAGE_JOURNAL_OPERATIONS_PER_PAGE;
  const maxJournalOperations = budget.maxPages * journalPerPage;
  const problems: string[] = [];
  if (ledger.pagesAttempted > budget.maxPages ||
      ledger.pagesCompleted > ledger.pagesAttempted ||
      ledger.documentsObserved > budget.maxDocuments ||
      ledger.failedPages > ledger.pagesAttempted ||
      ledger.reservedDocumentReads > budget.maxDocumentReads ||
      ledger.reservedDocumentReads !==
        ledger.pagesAttempted * maxJobReadsPerPage ||
      !whole(journalReservedOperations) ||
      journalReservedOperations > maxJournalOperations ||
      journalReservedOperations !== ledger.pagesAttempted * journalPerPage) {
    problems.push('RESERVATION_LEDGER_INCONSISTENT');
  }
  if (ledger.changedOnReread > 0 || ledger.removedOnReread > 0 ||
      ledger.movedOnReread > 0) {
    problems.push('CONCURRENT_CHANGES_OBSERVED');
  }
  // Every lane is only a best-effort page sequence, not a pinned snapshot.
  problems.push('NO_GLOBAL_SNAPSHOT_OR_CROSS_LANE_RECONCILIATION');
  if (!evidence) {
    problems.push('JOURNAL_AND_QUERY_ACTUAL_COST_NOT_MEASURED');
  } else if (evidence.source !== 'EMULATOR_INSTRUMENTATION' ||
      ![
        evidence.jobQueryReads, evidence.jobPointReads,
        evidence.journalDocumentReads, evidence.journalDocumentWrites,
        evidence.transactionRetries, evidence.recoveryReads,
        evidence.statusReads, evidence.registrationOperations,
      ].every(whole) ||
      evidence.jobQueryReads + evidence.jobPointReads >
        ledger.reservedDocumentReads ||
      evidence.transactionRetries >
        (ledger.pagesAttempted * 2 + 1) *
          (VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS - 1) ||
      evidence.recoveryReads > evidence.journalDocumentReads ||
      evidence.statusReads > evidence.journalDocumentReads ||
      evidence.registrationOperations >
        2 * VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS) {
    problems.push('COST_MEASUREMENT_INCONSISTENT');
  } else {
    // Emulated instrumentation is informative, never a production bill.
    problems.push('EMULATOR_MEASUREMENT_NOT_PRODUCTION_BILLING');
  }
  const inconsistent = problems.includes('RESERVATION_LEDGER_INCONSISTENT') ||
    problems.includes('COST_MEASUREMENT_INCONSISTENT');
  return {
    scope: 'OFFLINE_SESSION_ONLY',
    globalCoverageVerified: false,
    concurrentCursorSafetyVerified: false,
    productionCostVerified: false,
    globalOrderingEnabled: false,
    measuredOperationsVerified: false,
    consistency: inconsistent ? 'INCONSISTENT' : 'CONSISTENT',
    coverage: problems.includes('CONCURRENT_CHANGES_OBSERVED') ?
      'CONCURRENT_CHANGES_OBSERVED' : 'NOT_PROVEN',
    cost: !evidence ? 'NOT_MEASURED' :
      inconsistent ? 'INCONSISTENT' : 'MEASUREMENT_REVIEW',
    blockingReasons: problems,
    limits: {
      maxJobReadsPerPage,
      jobReadsReserved: ledger.reservedDocumentReads,
      maxJournalOperationsPerPage: journalPerPage,
      journalOperationsReserved: journalReservedOperations,
      maxJournalOperations,
      combinedReservationUpperBound:
        ledger.reservedDocumentReads + journalReservedOperations,
    },
  };
}
