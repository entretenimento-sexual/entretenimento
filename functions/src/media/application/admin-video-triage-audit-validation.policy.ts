/**
 * c18l: offline, deterministic validation of a manually authorized,
 * emulator-only audit. It does not read Firestore or grant global readiness.
 *
 * An upper-bound reservation is NOT a billing statement. In particular,
 * repeated recovery/status reads and transaction contention need separately
 * measured evidence before production cost claims can be made.
 */
import {
  openVideoTriageAuditCheckpoint, type VideoTriageAuditApproval,
} from './admin-video-triage-audit-session.policy';
import {
  VIDEO_TRIAGE_AUDIT_TX_MAX_ATTEMPTS,
  VIDEO_TRIAGE_JOURNAL_OPERATIONS_PER_PAGE,
} from './admin-video-triage-audit-journal.firestore';

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
