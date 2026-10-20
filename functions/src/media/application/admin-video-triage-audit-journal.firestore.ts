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
  schemaVersion: 1;
  projectId: string;
  databaseId: '(default)';
  sessionId: string;
  checkpointDigest: string;
  generation: number;
  ledger: VideoTriageAuditLedger;
  active: ActiveAuditLease | null;
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
    'APPLIED' | 'SUPERSEDED' | 'DUPLICATE';
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

function readDocument(
  data: unknown, approval: VideoTriageAuditApproval,
  key: Buffer
): DurableAuditSession {
  const entry = data as DurableAuditSession | null;
  if (!entry || entry.schemaVersion !== 1 ||
      entry.projectId !== approval.expectedProjectId ||
      entry.databaseId !== approval.expectedDatabaseId ||
      entry.sessionId !== approval.expectedSessionId ||
      !Number.isSafeInteger(entry.generation) || entry.generation < 0) {
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
  checkpoint: string, key: Buffer
): Promise<VideoTriageAuditReport> {
  const id = guard(db, app, approval);
  const ledger = openVideoTriageAuditCheckpoint(checkpoint, key, approval);
  if (ledger.sessionId !== id || ledger.pagesAttempted !== 0 ||
      ledger.pagesCompleted !== 0 || ledger.reservedDocumentReads !== 0) {
    throw new Error('Durable journal requires a pristine signed session.');
  }
  await db.runTransaction(async tx => {
    const ref = refFor(db, id);
    if ((await tx.get(ref)).exists) {
      throw new Error('Audit session is already registered.');
    }
    const record: DurableAuditSession = {
      schemaVersion: 1, projectId: ledger.projectId,
      databaseId: '(default)', sessionId: id,
      checkpointDigest: digest(checkpoint), generation: 0,
      ledger, active: null,
    };
    tx.create(ref, record);
  }, { maxAttempts: VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS });
  return reportVideoTriageAudit(ledger);
}

/** Read-only recovery of the canonical checkpoint; no job reads. */
export async function readDurableVideoTriageAuditJournal(
  db: Firestore, app: App, approval: VideoTriageAuditApproval,
  key: Buffer
): Promise<{ checkpoint: string; report: VideoTriageAuditReport;
  generation: number; inFlight: boolean }> {
  const id = guard(db, app, approval);
  const doc = await refFor(db, id).get();
  if (!doc.exists) throw new Error('Audit journal not registered.');
  const entry = readDocument(doc.data(), approval, key);
  return {
    checkpoint: sealVideoTriageAuditCheckpoint(entry.ledger, key),
    report: reportVideoTriageAudit(entry.ledger),
    generation: entry.generation, inFlight: !!entry.active,
  };
}

/**
 * Reserves before any job read. Competing transactions serialize on the
 * session document. An abandoned lease is counted once as an attempted
 * failed page and never credits cursor/projection counts.
 */
export async function claimDurableVideoTriageAuditPage(
  db: Firestore, app: App, approval: VideoTriageAuditApproval,
  expectedCheckpoint: string, key: Buffer,
  ownerId: string, now: number
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
    const ref = refFor(db, id);
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error('Audit journal not registered.');
    const entry = readDocument(doc.data(), approval, key);
    if (entry.checkpointDigest !== digest(expectedCheckpoint)) {
      return { kind: 'STALE_CHECKPOINT' as const,
        report: reportVideoTriageAudit(entry.ledger) };
    }
    if (entry.active && entry.active.until > now) {
      return { kind: 'BUSY' as const,
        report: reportVideoTriageAudit(entry.ledger) };
    }

    const ledger = structuredClone(entry.ledger);
    if (entry.active) {
      ledger.failedPages++;
      ledger.consecutiveFailures++;
      ledger.lastReadFailed = true;
      ledger.lastStepAt = now;
      ledger.status = ledger.failedPages > ledger.budget.maxFailures ?
        'STOPPED_BUDGET' : 'PAUSED_FAILURE';
    }
    const permission = videoTriageAuditCanRead(ledger, now);
    if (!permission.allowed) {
      ledger.status = permission.reason === 'EXPIRED' ? 'EXPIRED' :
        permission.reason === 'STOPPED_BUDGET' ? 'STOPPED_BUDGET' :
          ledger.status;
      const updated = sealVideoTriageAuditCheckpoint(ledger, key);
      tx.update(ref, {
        ledger, checkpointDigest: digest(updated), active: null,
      });
      return { kind: 'STOPPED' as const,
        report: reportVideoTriageAudit(ledger) };
    }

    // Reserve the complete upper bound before the query can execute.
    const cost = 2 * ledger.budget.pageSize + 1;
    ledger.pagesAttempted++;
    ledger.reservedDocumentReads += cost;
    ledger.lastStepAt = now;
    ledger.status = 'OPEN';
    ledger.lastReadFailed = false;
    const generation = entry.generation + 1;
    const lease: ActiveAuditLease = {
      ownerId, attemptId: randomUUID(), generation,
      claimedAt: now, until: Math.min(
        now + VIDEO_TRIAGE_AUDIT_LEASE_MS,
        ledger.createdAt + ledger.budget.maxDurationMs),
      lane: ledger.lanes[ledger.nextLaneIndex].state,
      afterId: ledger.lanes[ledger.nextLaneIndex].afterId,
    };
    const checkpoint = sealVideoTriageAuditCheckpoint(ledger, key);
    tx.update(ref, {
      ledger, checkpointDigest: digest(checkpoint),
      active: lease, generation,
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
  page: VideoTriageConcurrentAuditPage | null, now: number
): Promise<VideoTriageAuditSettlement> {
  const id = guard(db, app, approval);
  checkedClock(now);
  if (claim.sessionId !== id) throw new Error('Audit settlement session mismatch.');
  return db.runTransaction(async tx => {
    const ref = refFor(db, id);
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error('Audit journal missing.');
    const entry = readDocument(doc.data(), approval, key);
    const active = entry.active;
    if (!active) {
      return { kind: entry.generation === claim.generation ?
        'DUPLICATE' as const : 'SUPERSEDED' as const,
      report: reportVideoTriageAudit(entry.ledger) };
    }
    if (entry.generation !== claim.generation ||
        active.attemptId !== claim.fence ||
        active.ownerId !== claim.ownerId ||
        active.generation !== claim.generation ||
        active.lane !== claim.lane ||
        active.afterId !== claim.afterId ||
        active.until <= now) {
      return { kind: 'SUPERSEDED' as const,
        report: reportVideoTriageAudit(entry.ledger) };
    }
    const ledger = settleVideoTriageAuditPage(
      entry.ledger, now, page, true);
    const checkpoint = sealVideoTriageAuditCheckpoint(ledger, key);
    tx.update(ref, {
      ledger, checkpointDigest: digest(checkpoint),
      active: null,
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
  readPage: typeof auditVideoTriageConcurrentPage = auditVideoTriageConcurrentPage
): Promise<VideoTriageJournalStep> {
  const owner = randomUUID();
  const claimed = await claimDurableVideoTriageAuditPage(
    db, app, approval, checkpoint, key, owner, clock());
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
  const settled = await settleDurableVideoTriageAuditPage(
    db, app, approval, key, claimed.claim, page, clock());
  return {
    ...settled, readFailed,
    page: settled.kind === 'APPLIED' ? page : null,
  };
}
