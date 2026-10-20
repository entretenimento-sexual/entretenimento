/**
 * c18i manual offline audit coordinator: exactly one bounded page per call.
 * It is intentionally not connected to production Functions, schedulers or UI.
 * Requires an actual local Firestore Emulator and a signed checkpoint.
 */
import type { App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import {
  auditVideoTriageConcurrentPage,
  type VideoTriageConcurrentAuditPage,
} from './admin-video-triage-evidence-audit.firestore';
import {
  openVideoTriageAuditCheckpoint, reportVideoTriageAudit,
  sealVideoTriageAuditCheckpoint, settleVideoTriageAuditPage,
  videoTriageAuditCanRead,
  type VideoTriageAuditApproval, type VideoTriageAuditReport,
  type VideoTriageAuditLedger,
} from './admin-video-triage-audit-session.policy';

export interface VideoTriageAuditStepResult {
  checkpoint: string;
  report: VideoTriageAuditReport;
  page: VideoTriageConcurrentAuditPage | null;
  stopped: boolean;
  /** Never expose raw Firestore errors, job contents or session keys. */
  readFailed: boolean;
}

function checkEmulatorIdentity(
  db: Firestore, app: App, approval: VideoTriageAuditApproval
) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (typeof host !== 'string' ||
      !/^127\.0\.0\.1:\d{2,5}$/.test(host) ||
      app.options.projectId !== approval.expectedProjectId ||
      getFirestore(app) !== db ||
      db.databaseId !== approval.expectedDatabaseId) {
    throw new Error('Triage audit only supports the explicitly bound local emulator.');
  }
}

function finalized(
  state: VideoTriageAuditLedger, secret: Buffer,
  page: VideoTriageConcurrentAuditPage | null, readFailed: boolean,
  stopped: boolean
): VideoTriageAuditStepResult {
  return {
    checkpoint: sealVideoTriageAuditCheckpoint(state, secret),
    report: reportVideoTriageAudit(state),
    page, readFailed, stopped,
  };
}

export async function runOneVideoTriageAuditPage(
  db: Firestore,
  app: App,
  approval: VideoTriageAuditApproval,
  checkpoint: string,
  secret: Buffer,
  clock: () => number = Date.now,
  /** Emulator-only injected read for deterministic failure tests. */
  readPage: typeof auditVideoTriageConcurrentPage = auditVideoTriageConcurrentPage
): Promise<VideoTriageAuditStepResult> {
  // Reject production/remote databases before any Firestore operation.
  checkEmulatorIdentity(db, app, approval);
  const ledger = openVideoTriageAuditCheckpoint(checkpoint, secret, approval);
  const start = clock();
  const permit = videoTriageAuditCanRead(ledger, start);
  if (!permit.allowed) {
    const halted: VideoTriageAuditLedger = {
      ...ledger, lastStepAt: Number.isSafeInteger(start) &&
        start >= ledger.lastStepAt ? start : ledger.lastStepAt,
      status: permit.reason === 'EXPIRED' ? 'EXPIRED' :
        permit.reason === 'STOPPED_BUDGET' ? 'STOPPED_BUDGET' :
          ledger.status,
    };
    return finalized(halted, secret, null, false, true);
  }
  const lane = ledger.lanes[ledger.nextLaneIndex];
  let page: VideoTriageConcurrentAuditPage | null = null;
  let failed = false;
  try {
    page = await readPage(db, {
      state: lane.state, afterId: lane.afterId,
      limit: ledger.budget.pageSize, now: ledger.evaluationAt,
    });
  } catch {
    // Firestore may have charged reads before throwing: reserve the full
    // per-attempt upper bound, do not advance cursors or invent empty results.
    failed = true;
  }
  const end = clock();
  const next = settleVideoTriageAuditPage(ledger, start, page);
  if (Number.isSafeInteger(end) && end >= start &&
      end - next.createdAt >= next.budget.maxDurationMs) {
    next.status = 'EXPIRED';
    next.lastStepAt = end;
  }
  const allowedNext = videoTriageAuditCanRead(next, next.lastStepAt);
  const stopped = next.status === 'LANES_EXAMINED' ||
    next.status === 'INCONCLUSIVE' || next.status === 'EXPIRED' ||
    next.status === 'STOPPED_BUDGET' || !allowedNext.allowed;
  return finalized(next, secret, page, failed, stopped);
}
