/**
 * c18i manually-driven video triage audit ledger. Each checkpoint is HMAC
 * sealed with an operator-held ephemeral key; a hash without a secret is not
 * proof of authenticity. The key and token must never be put in logs.
 *
 * No production access, automatic iteration, scheduling or global proof.
 * No durable replay lock: one operator MUST serialize use of a checkpoint.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  VIDEO_TRIAGE_BACKFILL_STATES, type VideoTriageBackfillState,
} from './admin-video-triage-backfill.firestore';
import {
  type VideoTriageConcurrentAuditPage,
} from './admin-video-triage-evidence-audit.firestore';
import {
  type VideoTriageIntegrity,
} from './admin-video-triage-consistency.firestore';

export const VIDEO_TRIAGE_SESSION_MAX_PAGES = 100;
export const VIDEO_TRIAGE_SESSION_MAX_DOCUMENTS = 2_000;
export const VIDEO_TRIAGE_SESSION_MAX_READS = 4_100;
export const VIDEO_TRIAGE_SESSION_MAX_DURATION_MS = 30 * 60_000;
export const VIDEO_TRIAGE_SESSION_MAX_FAILURES = 2;
export const VIDEO_TRIAGE_SESSION_MAX_TOKEN_BYTES = 8_192;

export interface VideoTriageAuditBudget {
  pageSize: number;
  maxPages: number;
  maxDocuments: number;
  maxDocumentReads: number;
  maxDurationMs: number;
  maxFailures: number;
}

export interface VideoTriageAuditApproval {
  approved: true;
  purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT';
  expectedProjectId: string;
  expectedDatabaseId: '(default)';
  /** Explicitly matches one session on resume, preventing cross-run mixing. */
  expectedSessionId?: string;
}

export type VideoTriageAuditStatus =
  'OPEN' | 'PAUSED_FAILURE' | 'STOPPED_BUDGET' | 'EXPIRED' |
  'LANES_EXAMINED' | 'INCONCLUSIVE';

export interface VideoTriageAuditLane {
  state: VideoTriageBackfillState;
  afterId: string | null;
  finished: boolean;
  pagesCompleted: number;
}

export type VideoTriageAuditIntegrityCounts = Record<VideoTriageIntegrity, number>;

export interface VideoTriageAuditLedger {
  version: 1;
  scope: 'EMULATOR_ONLY';
  sessionId: string;
  projectId: string;
  databaseId: '(default)';
  createdAt: number;
  evaluationAt: number;
  lastStepAt: number;
  budget: VideoTriageAuditBudget;
  status: VideoTriageAuditStatus;
  lanes: VideoTriageAuditLane[];
  nextLaneIndex: number;
  pagesAttempted: number;
  pagesCompleted: number;
  documentsObserved: number;
  reservedDocumentReads: number;
  failedPages: number;
  consecutiveFailures: number;
  changedOnReread: number;
  removedOnReread: number;
  movedOnReread: number;
  integrity: VideoTriageAuditIntegrityCounts;
  lastReadFailed: boolean;
  /** Never a serializable, globally pinned collection snapshot. */
  globalCoverageVerified: false;
  concurrentCursorSafetyVerified: false;
}

export interface VideoTriageAuditReport {
  scope: 'SESSION_PARTIAL';
  status: VideoTriageAuditStatus;
  sessionId: string;
  projectId: string;
  databaseId: '(default)';
  lanesExamined: number;
  lanesTotal: 7;
  pagesAttempted: number;
  pagesCompleted: number;
  documentsObserved: number;
  reservedDocumentReads: number;
  failedPages: number;
  changedOnReread: number;
  removedOnReread: number;
  movedOnReread: number;
  integrity: VideoTriageAuditIntegrityCounts;
  globalCoverageVerified: false;
  concurrentCursorSafetyVerified: false;
  eligibleForIndependentReview: false;
  globalOrderingEnabled: false;
}

function validNumber(n: number, low: number, high: number): boolean {
  return Number.isSafeInteger(n) && n >= low && n <= high;
}

function verifyBudget(budget: VideoTriageAuditBudget): void {
  if (!budget ||
      !validNumber(budget.pageSize, 1, 20) ||
      !validNumber(budget.maxPages, 1, VIDEO_TRIAGE_SESSION_MAX_PAGES) ||
      !validNumber(budget.maxDocuments, 1, VIDEO_TRIAGE_SESSION_MAX_DOCUMENTS) ||
      !validNumber(budget.maxDocumentReads, 1, VIDEO_TRIAGE_SESSION_MAX_READS) ||
      !validNumber(budget.maxDurationMs, 1, VIDEO_TRIAGE_SESSION_MAX_DURATION_MS) ||
      !validNumber(budget.maxFailures, 0, VIDEO_TRIAGE_SESSION_MAX_FAILURES)) {
    throw new RangeError('Invalid cumulative audit budget.');
  }
}

function verifyKey(secret: Buffer): void {
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    throw new RangeError('Operator checkpoint signing key must be at least 32 bytes.');
  }
}

function projectId(value: string): boolean {
  return typeof value === 'string' &&
    /^(demo-)?[a-z][a-z0-9-]{4,62}$/.test(value);
}

function verifyApproval(approval: VideoTriageAuditApproval): void {
  if (!approval || approval.approved !== true ||
      approval.purpose !== 'MANUAL_EMULATOR_TRIAGE_AUDIT' ||
      approval.expectedDatabaseId !== '(default)' ||
      !projectId(approval.expectedProjectId)) {
    throw new Error('Audit requires explicit emulator-only authorization.');
  }
}

function sign(raw: string, key: Buffer): string {
  return createHmac('sha256', key).update(raw, 'utf8').digest('base64url');
}

/** Signed checkpoint, not an encrypted record; do not include user PII. */
export function sealVideoTriageAuditCheckpoint(
  ledger: VideoTriageAuditLedger, secret: Buffer
): string {
  verifyKey(secret);
  const body = Buffer.from(JSON.stringify(ledger), 'utf8').toString('base64url');
  if (body.length > VIDEO_TRIAGE_SESSION_MAX_TOKEN_BYTES) {
    throw new RangeError('Audit checkpoint exceeds bounded token size.');
  }
  return body + '.' + sign(body, secret);
}

export function openVideoTriageAuditCheckpoint(
  token: string, secret: Buffer, approval: VideoTriageAuditApproval
): VideoTriageAuditLedger {
  verifyKey(secret);
  verifyApproval(approval);
  if (typeof token !== 'string' ||
      token.length > VIDEO_TRIAGE_SESSION_MAX_TOKEN_BYTES + 64) {
    throw new Error('Malformed audit checkpoint.');
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) {
    throw new Error('Malformed audit checkpoint.');
  }
  const expected = Buffer.from(sign(parts[0], secret), 'utf8');
  const supplied = Buffer.from(parts[1], 'utf8');
  if (expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)) {
    throw new Error('Audit checkpoint authentication failed.');
  }
  const ledger = JSON.parse(
    Buffer.from(parts[0], 'base64url').toString('utf8')
  ) as VideoTriageAuditLedger;
  if (!ledger || ledger.version !== 1 || ledger.scope !== 'EMULATOR_ONLY' ||
      ledger.projectId !== approval.expectedProjectId ||
      ledger.databaseId !== approval.expectedDatabaseId ||
      (approval.expectedSessionId && ledger.sessionId !== approval.expectedSessionId) ||
      !/^[0-9a-f-]{36}$/.test(ledger.sessionId) ||
      !Array.isArray(ledger.lanes) ||
      ledger.lanes.length !== VIDEO_TRIAGE_BACKFILL_STATES.length ||
      !validNumber(ledger.nextLaneIndex, 0, ledger.lanes.length)) {
    throw new Error('Checkpoint context mismatch or invalid ledger.');
  }
  verifyBudget(ledger.budget);
  for (let i = 0; i < ledger.lanes.length; i++) {
    const lane = ledger.lanes[i];
    if (!lane || lane.state !== VIDEO_TRIAGE_BACKFILL_STATES[i] ||
        typeof lane.finished !== 'boolean' ||
        !validNumber(lane.pagesCompleted, 0, ledger.budget.maxPages) ||
        (lane.afterId !== null &&
          (typeof lane.afterId !== 'string' ||
            !/^[A-Za-z0-9_-]{1,257}$/.test(lane.afterId)))) {
      throw new Error('Invalid audit checkpoint lane.');
    }
  }
  if (!validNumber(ledger.pagesAttempted, 0, ledger.budget.maxPages) ||
      !validNumber(ledger.pagesCompleted, 0, ledger.pagesAttempted) ||
      !validNumber(ledger.reservedDocumentReads, 0,
        ledger.budget.maxDocumentReads) ||
      !validNumber(ledger.documentsObserved, 0, ledger.budget.maxDocuments) ||
      !validNumber(ledger.createdAt, 1, Number.MAX_SAFE_INTEGER) ||
      !validNumber(ledger.lastStepAt, ledger.createdAt,
        Number.MAX_SAFE_INTEGER) ||
      ledger.globalCoverageVerified !== false ||
      ledger.concurrentCursorSafetyVerified !== false) {
    throw new Error('Invalid audit checkpoint counters.');
  }
  return ledger;
}

function emptyIntegrity(): VideoTriageAuditIntegrityCounts {
  return {
    CURRENT: 0, MISSING_PROJECTION: 0, STALE_VERSION: 0,
    DIVERGENT: 0, TIME_DUE: 0, TERMINAL_RESIDUE: 0,
    UNVERSIONED: 0, TERMINAL_CLEAR: 0,
  };
}

export function createVideoTriageAuditSession(
  approval: VideoTriageAuditApproval,
  budget: VideoTriageAuditBudget,
  secret: Buffer, now: number
): { sessionId: string; checkpoint: string } {
  verifyApproval(approval);
  verifyBudget(budget);
  verifyKey(secret);
  if (!validNumber(now, 1, Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Invalid audit session start time.');
  }
  const sessionId = randomUUID();
  const ledger: VideoTriageAuditLedger = {
    version: 1, scope: 'EMULATOR_ONLY', sessionId,
    projectId: approval.expectedProjectId, databaseId: '(default)',
    createdAt: now, evaluationAt: now, lastStepAt: now, budget,
    status: 'OPEN',
    lanes: VIDEO_TRIAGE_BACKFILL_STATES.map(state => ({
      state, afterId: null, finished: false, pagesCompleted: 0,
    })),
    nextLaneIndex: 0, pagesAttempted: 0, pagesCompleted: 0,
    documentsObserved: 0, reservedDocumentReads: 0,
    failedPages: 0, consecutiveFailures: 0,
    changedOnReread: 0, removedOnReread: 0, movedOnReread: 0,
    integrity: emptyIntegrity(), lastReadFailed: false,
    globalCoverageVerified: false, concurrentCursorSafetyVerified: false,
  };
  return { sessionId, checkpoint: sealVideoTriageAuditCheckpoint(ledger, secret) };
}

export function videoTriageAuditCanRead(
  ledger: VideoTriageAuditLedger, now: number
): { allowed: boolean; reason: 'OPEN' | 'EXPIRED' | 'STOPPED_BUDGET' | 'FINISHED' } {
  if (!validNumber(now, ledger.lastStepAt, Number.MAX_SAFE_INTEGER) ||
      now - ledger.createdAt >= ledger.budget.maxDurationMs) {
    return { allowed: false, reason: 'EXPIRED' };
  }
  if (ledger.nextLaneIndex >= ledger.lanes.length) {
    return { allowed: false, reason: 'FINISHED' };
  }
  const { budget } = ledger;
  if (ledger.pagesAttempted >= budget.maxPages ||
      ledger.documentsObserved + budget.pageSize > budget.maxDocuments ||
      ledger.reservedDocumentReads + 2 * budget.pageSize + 1 >
        budget.maxDocumentReads ||
      ledger.failedPages > budget.maxFailures) {
    return { allowed: false, reason: 'STOPPED_BUDGET' };
  }
  return { allowed: true, reason: 'OPEN' };
}

/**
 * Deterministic state transition ONLY; the Firestore call is owned by the
 * offline runner. Reserve its full upper bound before crediting a result.
 */
export function settleVideoTriageAuditPage(
  ledger: VideoTriageAuditLedger,
  now: number,
  page: VideoTriageConcurrentAuditPage | null,
  reservationAlreadyCharged = false
): VideoTriageAuditLedger {
  const permit = videoTriageAuditCanRead(ledger, now);
  const fee = 2 * ledger.budget.pageSize + 1;
  if (reservationAlreadyCharged) {
    if (ledger.pagesAttempted < 1 || ledger.reservedDocumentReads < fee) {
      throw new Error('Audit page has no prior durable reservation.');
    }
  } else if (!permit.allowed) {
    throw new Error('Audit cannot consume another page.');
  }
  const laneIndex = ledger.nextLaneIndex;
  const lane = ledger.lanes[laneIndex];
  if (page && (page.state !== lane.state ||
      page.scope !== 'PAGE_ONLY' ||
      page.consistency !== 'BEST_EFFORT_NOT_SNAPSHOT' ||
      page.maxWrites !== 0 || page.provesGlobalCoverage !== false ||
      page.concurrentCursorSafetyVerified !== false ||
      !validNumber(page.observed, 0, ledger.budget.pageSize) ||
      !validNumber(page.maxDocumentReads, 0,
        2 * ledger.budget.pageSize + 1) ||
      page.checkedAt !== ledger.evaluationAt ||
      !validNumber(page.stableOnReread, 0, page.observed) ||
      !validNumber(page.changedOnReread, 0, page.observed) ||
      !validNumber(page.removedOnReread, 0, page.observed) ||
      !validNumber(page.movedOnReread, 0, page.changedOnReread) ||
      !validNumber(page.maxQueryReads, 0, ledger.budget.pageSize + 1) ||
      !validNumber(page.maxPointReads, 0, ledger.budget.pageSize) ||
      page.maxQueryReads !== ledger.budget.pageSize + 1 ||
      page.maxPointReads !== page.observed ||
      page.maxDocumentReads !== page.maxQueryReads + page.maxPointReads ||
      page.stableOnReread + page.changedOnReread +
        page.removedOnReread !== page.observed ||
      typeof page.hasMore !== 'boolean' ||
      (page.hasMore && (page.observed !== ledger.budget.pageSize ||
        typeof page.nextCursor !== 'string' ||
        !/^[A-Za-z0-9_-]{1,257}$/.test(page.nextCursor) ||
        (lane.afterId !== null && page.nextCursor <= lane.afterId))) ||
      (!page.hasMore && page.nextCursor !== null) ||
      !page.counts || typeof page.counts !== 'object' ||
      Object.keys(page.counts).length !== Object.keys(ledger.integrity).length ||
      Object.keys(ledger.integrity).some(key =>
        !validNumber(page.counts[key as VideoTriageIntegrity], 0, page.observed)) ||
      Object.values(page.counts).reduce((sum, value) => sum + value, 0) !==
        page.observed)) {
    throw new Error('Malformed audit page cannot update checkpoint.');
  }
  const next = structuredClone(ledger);
  next.lastStepAt = now;
  if (!reservationAlreadyCharged) {
    next.pagesAttempted++;
    next.reservedDocumentReads += fee;
  }
  if (!page) {
    next.failedPages++;
    next.consecutiveFailures++;
    next.lastReadFailed = true;
    next.status = next.failedPages > next.budget.maxFailures ?
      'STOPPED_BUDGET' : 'PAUSED_FAILURE';
  } else {
    next.pagesCompleted++;
    next.consecutiveFailures = 0;
    next.lastReadFailed = false;
    next.documentsObserved += page.observed;
    next.changedOnReread += page.changedOnReread;
    next.removedOnReread += page.removedOnReread;
    next.movedOnReread += page.movedOnReread;
    for (const key of Object.keys(next.integrity) as VideoTriageIntegrity[]) {
      next.integrity[key] += page.counts[key];
    }
    next.lanes[laneIndex].pagesCompleted++;
    next.lanes[laneIndex].afterId = page.nextCursor;
    if (!page.hasMore) {
      next.lanes[laneIndex].finished = true;
      next.nextLaneIndex++;
    }
    next.status = next.nextLaneIndex === next.lanes.length ?
      (next.changedOnReread || next.removedOnReread ?
        'INCONCLUSIVE' : 'LANES_EXAMINED') : 'OPEN';
  }
  if (now - next.createdAt >= next.budget.maxDurationMs) {
    next.status = 'EXPIRED';
  } else if (next.nextLaneIndex < next.lanes.length &&
      !videoTriageAuditCanRead(next, now).allowed) {
    next.status = 'STOPPED_BUDGET';
  }
  return next;
}

export function reportVideoTriageAudit(
  ledger: VideoTriageAuditLedger
): VideoTriageAuditReport {
  return {
    scope: 'SESSION_PARTIAL', status: ledger.status,
    sessionId: ledger.sessionId, projectId: ledger.projectId,
    databaseId: ledger.databaseId,
    lanesExamined: ledger.lanes.filter(lane => lane.finished).length,
    lanesTotal: 7, pagesAttempted: ledger.pagesAttempted,
    pagesCompleted: ledger.pagesCompleted,
    documentsObserved: ledger.documentsObserved,
    reservedDocumentReads: ledger.reservedDocumentReads,
    failedPages: ledger.failedPages,
    changedOnReread: ledger.changedOnReread,
    removedOnReread: ledger.removedOnReread,
    movedOnReread: ledger.movedOnReread,
    integrity: { ...ledger.integrity },
    globalCoverageVerified: false, concurrentCursorSafetyVerified: false,
    eligibleForIndependentReview: false, globalOrderingEnabled: false,
  };
}

/** c18m emulator fixture reconciliation; never production coverage proof. */
export const VIDEO_TRIAGE_COVERAGE_FIXTURE_MAX_IDS = 20;
export const VIDEO_TRIAGE_COVERAGE_FIXTURE_MAX_PAGES = 100;

export interface VideoTriageFixtureRecord {
  id: string;
  state: VideoTriageBackfillState;
  revision: string;
}

export interface VideoTriageFixturePage {
  state: VideoTriageBackfillState;
  afterId: string | null;
  ids: readonly string[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface VideoTriageFixtureReconciliation {
  scope: 'EMULATOR_FIXTURE_ONLY';
  status: 'FIXTURE_RECONCILED' | 'GAPS_OR_DUPLICATES' | 'INCONCLUSIVE';
  baselineSize: number;
  observedTotal: number;
  uniqueObserved: number;
  missingCount: number;
  duplicateCount: number;
  unexpectedCount: number;
  changedCount: number;
  invalidCursorPages: number;
  lanesComplete: boolean;
  globalCoverageVerified: false;
  concurrentCursorSafetyVerified: false;
  productionCostVerified: false;
  globalOrderingEnabled: false;
}

function validId(id: string): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,257}$/.test(id);
}

function knownState(state: string): state is VideoTriageBackfillState {
  return VIDEO_TRIAGE_BACKFILL_STATES.some(item => item === state);
}

function mapFixture(records: readonly VideoTriageFixtureRecord[]) {
  if (!Array.isArray(records) || records.length > VIDEO_TRIAGE_COVERAGE_FIXTURE_MAX_IDS) {
    throw new RangeError('Unbounded emulator coverage fixture.');
  }
  const byId = new Map<string, VideoTriageFixtureRecord>();
  for (const item of records) {
    if (!item || !validId(item.id) || !knownState(item.state) ||
        typeof item.revision !== 'string' ||
        item.revision.length < 1 || item.revision.length > 128 ||
        byId.has(item.id)) {
      throw new Error('Invalid or repeated fixture identity.');
    }
    byId.set(item.id, item);
  }
  return byId;
}

/** Never derives global proof, even when an emulator fixture matches. */
export function reconcileVideoTriageFixture(
  baseline: readonly VideoTriageFixtureRecord[],
  after: readonly VideoTriageFixtureRecord[],
  pages: readonly VideoTriageFixturePage[]
): VideoTriageFixtureReconciliation {
  const before = mapFixture(baseline);
  const final = mapFixture(after);
  if (!Array.isArray(pages) ||
      pages.length > VIDEO_TRIAGE_COVERAGE_FIXTURE_MAX_PAGES) {
    throw new RangeError('Unbounded emulator coverage pages.');
  }

  const observed = new Map<string, number>();
  let invalidCursorPages = 0;
  const progress = new Map<VideoTriageBackfillState, {
    cursor: string | null; complete: boolean;
  }>();
  for (const page of pages) {
    if (!page || !knownState(page.state) || !Array.isArray(page.ids) ||
        page.ids.length > VIDEO_TRIAGE_COVERAGE_FIXTURE_MAX_IDS ||
        !page.ids.every(validId)) {
      throw new Error('Malformed emulator coverage page.');
    }
    const previous = progress.get(page.state);
    let invalid = previous?.complete === true ||
      (previous !== undefined && previous.cursor !== page.afterId) ||
      // A bounded emulator fixture may start after an explicit ID fence.
      (page.afterId !== null && !validId(page.afterId));
    let cursor = page.afterId;
    for (const id of page.ids) {
      if (cursor !== null && id <= cursor) invalid = true;
      cursor = id;
      observed.set(id, (observed.get(id) ?? 0) + 1);
    }
    if (typeof page.hasMore !== 'boolean' ||
        (page.hasMore && (page.ids.length === 0 ||
          page.nextCursor !== cursor)) ||
        (!page.hasMore && page.nextCursor !== null)) {
      invalid = true;
    }
    if (invalid) invalidCursorPages++;
    progress.set(page.state, {
      cursor: page.hasMore ? page.nextCursor : null,
      complete: !page.hasMore,
    });
  }

  let missingCount = 0;
  let duplicateCount = 0;
  let unexpectedCount = 0;
  let changedCount = 0;
  for (const [id, record] of before) {
    const seen = observed.get(id) ?? 0;
    if (seen === 0) missingCount++;
    if (seen > 1) duplicateCount += seen - 1;
    const updated = final.get(id);
    if (!updated || updated.state !== record.state ||
        updated.revision !== record.revision) changedCount++;
  }
  for (const [id, count] of observed) {
    if (!before.has(id)) unexpectedCount += count;
  }
  for (const id of final.keys()) {
    if (!before.has(id)) changedCount++;
  }
  const lanesComplete = VIDEO_TRIAGE_BACKFILL_STATES.every(
    lane => progress.get(lane)?.complete === true);
  const consistent = missingCount === 0 && duplicateCount === 0 &&
    unexpectedCount === 0 && invalidCursorPages === 0;
  const status = !consistent ? 'GAPS_OR_DUPLICATES' :
    changedCount !== 0 || !lanesComplete ? 'INCONCLUSIVE' :
      'FIXTURE_RECONCILED';

  return {
    scope: 'EMULATOR_FIXTURE_ONLY', status, baselineSize: before.size,
    observedTotal: [...observed.values()].reduce((n, count) => n + count, 0),
    uniqueObserved: observed.size, missingCount, duplicateCount,
    unexpectedCount, changedCount, invalidCursorPages, lanesComplete,
    globalCoverageVerified: false, concurrentCursorSafetyVerified: false,
    productionCostVerified: false, globalOrderingEnabled: false,
  };
}
