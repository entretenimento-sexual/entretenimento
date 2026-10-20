/**
 * c18g preparatory global-triage readiness gate.
 * Evidence passed to this module is an operator-supplied report, NOT verified
 * by this library. No combination of reports authorizes global sort/deploy.
 * Only an independent live production review may authorize that later.
 */
import {
  VIDEO_TRIAGE_BACKFILL_STATES,
} from './admin-video-triage-backfill.firestore';
import {
  assessAdminTriageActivation, type AdminTriageActivationEvidence,
} from './admin-video-global-triage.policy';

export const VIDEO_TRIAGE_GATE_FRESHNESS_MS = 15 * 60_000;
export const VIDEO_TRIAGE_GATE_MAX_REEVALUATION_LAG_MS = 15 * 60_000;

export interface VideoTriageIndexDescription {
  collectionGroup: string;
  queryScope: string;
  state: string;
  fields: Array<{ fieldPath: string; order: string }>;
}

export interface VideoTriageIndexEvidence {
  /** A declared JSON index or emulator query is not production index status. */
  source: 'FIRESTORE_ADMIN_API' | 'DECLARATION' | 'EMULATOR';
  environment: 'PRODUCTION' | 'EMULATOR';
  observedAt: number;
  indexes: readonly VideoTriageIndexDescription[];
}

export interface VideoTriageCoverageEvidence {
  /** PAGE_ONLY is never accepted as a globally consistent audit. */
  scope: 'PAGE_ONLY' | 'GLOBAL_CONSISTENT';
  observedAt: number;
  completeStates: readonly string[];
  fullReadCompleted: boolean;
  reconciledConcurrentMoves: boolean;
  actionableMissing: number;
  versionMismatches: number;
  overdueProjections: number;
  terminalResidue: number;
  unversionedLegacy: number;
}

export interface VideoTriageDriverEvidence {
  source: 'OPERATIONAL_CYCLES' | 'EMULATOR';
  observedAt: number;
  active: boolean;
  consecutiveSuccesses: number;
  lastSuccessfulAt: number;
  oldestUnprocessedLagMs: number;
  failedCycles: number;
}

export interface VideoTriageCursorEvidence {
  observedAt: number;
  globalSnapshotPinned: boolean;
  testedUnderConcurrentChanges: boolean;
  duplicateCount: number;
  skippedCount: number;
}

export interface VideoTriageBudgetEvidence {
  observedAt: number;
  maxPageSize: number;
  maxQueryReadsPerPage: number;
  maxTransactionReadsPerPage: number;
  maxWritesPerPage: number;
  maxTransactionAttempts: number;
}

export interface VideoTriageWriterEvidence {
  observedAt: number;
  stateVersionFencingVerified: boolean;
  sameVersionConcurrentWritesVerified: boolean;
  cancellationAndTerminalGuardsVerified: boolean;
}

export interface VideoTriageReadinessEvidence {
  indexes?: VideoTriageIndexEvidence | null;
  coverage?: VideoTriageCoverageEvidence | null;
  temporalDriver?: VideoTriageDriverEvidence | null;
  cursors?: VideoTriageCursorEvidence | null;
  budgets?: VideoTriageBudgetEvidence | null;
  writers?: VideoTriageWriterEvidence | null;
}

export interface VideoTriageReadinessResult {
  phase: 'BLOCKED' | 'REQUIRES_MANUAL_PRODUCTION_APPROVAL';
  /** An offline assessment can never activate a code path or grant permission. */
  globalOrderingEnabled: false;
  activationAuthorized: false;
  evidenceAuthority: 'UNVERIFIED_OPERATOR_INPUT';
  eligibleForIndependentReview: boolean;
  checkedAt: number;
  checks: AdminTriageActivationEvidence;
  blockedBy: (keyof AdminTriageActivationEvidence)[];
  /** Required despite every check passing. Never treat this as a feature flag. */
  nextStep: string;
}

function fresh(when: number, now: number): boolean {
  return Number.isSafeInteger(when) && when > 0 &&
    when <= now && now - when <= VIDEO_TRIAGE_GATE_FRESHNESS_MS;
}

function nonnegative(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

const INDEX_FIELDS = [
  ['adminTriageTier', 'adminTriageSince', '__name__'],
  ['adminTriageReevaluateAt', '__name__'],
] as const;

/** Validates SHAPE of reported REST index metadata, never its provenance. */
export function matchesVideoTriageIndexManifest(
  indexes: readonly VideoTriageIndexDescription[]
): boolean {
  return INDEX_FIELDS.every(fields => indexes.some(index =>
    index.collectionGroup === 'media_video_processing_jobs' &&
    index.queryScope === 'COLLECTION' && index.state === 'READY' &&
    index.fields.length === fields.length &&
    fields.every((field, i) =>
      index.fields[i]?.fieldPath === field &&
      index.fields[i]?.order === 'ASCENDING')));
}

/**
 * Required evidence is assessed fail-closed. A forged or unauthenticated
 * report cannot enable ordering because this evaluator never authorizes it.
 */
export function evaluateVideoTriageReadiness(
  report: VideoTriageReadinessEvidence | null | undefined,
  now: number
): VideoTriageReadinessResult {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new RangeError('Readiness gate requires a valid evaluation clock.');
  }
  const index = report?.indexes;
  const coverage = report?.coverage;
  const driver = report?.temporalDriver;
  const cursors = report?.cursors;
  const budget = report?.budgets;
  const writers = report?.writers;

  const coverageFresh = !!coverage && fresh(coverage.observedAt, now);
  const globallyConsistentAuditVerified = coverageFresh &&
    coverage.scope === 'GLOBAL_CONSISTENT' &&
    coverage.fullReadCompleted && coverage.reconciledConcurrentMoves &&
    VIDEO_TRIAGE_BACKFILL_STATES.every(state =>
      coverage.completeStates.includes(state));
  const allActionableProjected = globallyConsistentAuditVerified &&
    nonnegative(coverage.actionableMissing) && coverage.actionableMissing === 0 &&
    nonnegative(coverage.versionMismatches) && coverage.versionMismatches === 0 &&
    nonnegative(coverage.overdueProjections) && coverage.overdueProjections === 0;

  const checks: AdminTriageActivationEvidence = {
    deployedIndexReady: !!index && fresh(index.observedAt, now) &&
      index.source === 'FIRESTORE_ADMIN_API' &&
      index.environment === 'PRODUCTION' &&
      matchesVideoTriageIndexManifest(index.indexes),
    globallyConsistentAuditVerified,
    allActionableProjected,
    legacyCoverageVerified: globallyConsistentAuditVerified &&
      nonnegative(coverage.unversionedLegacy) && coverage.unversionedLegacy === 0,
    terminalDocumentsExcluded: globallyConsistentAuditVerified &&
      nonnegative(coverage.terminalResidue) && coverage.terminalResidue === 0,
    writerVersionFencingVerified: !!writers && fresh(writers.observedAt, now) &&
      writers.stateVersionFencingVerified &&
      writers.sameVersionConcurrentWritesVerified &&
      writers.cancellationAndTerminalGuardsVerified,
    dynamicReevaluationVerified: !!driver && fresh(driver.observedAt, now) &&
      driver.source === 'OPERATIONAL_CYCLES' && driver.active &&
      driver.consecutiveSuccesses >= 2 &&
      fresh(driver.lastSuccessfulAt, now) &&
      nonnegative(driver.oldestUnprocessedLagMs) &&
      driver.oldestUnprocessedLagMs <=
        VIDEO_TRIAGE_GATE_MAX_REEVALUATION_LAG_MS &&
      driver.failedCycles === 0,
    concurrentCursorSafetyVerified: !!cursors && fresh(cursors.observedAt, now) &&
      cursors.globalSnapshotPinned &&
      cursors.testedUnderConcurrentChanges &&
      cursors.duplicateCount === 0 && cursors.skippedCount === 0,
    boundedReadBudgetVerified: !!budget && fresh(budget.observedAt, now) &&
      Number.isSafeInteger(budget.maxPageSize) &&
      budget.maxPageSize > 0 && budget.maxPageSize <= 20 &&
      nonnegative(budget.maxQueryReadsPerPage) &&
      budget.maxQueryReadsPerPage <= 23 &&
      nonnegative(budget.maxTransactionReadsPerPage) &&
      budget.maxTransactionReadsPerPage <= 40 &&
      nonnegative(budget.maxWritesPerPage) &&
      budget.maxWritesPerPage <= 20 &&
      Number.isSafeInteger(budget.maxTransactionAttempts) &&
      budget.maxTransactionAttempts > 0 && budget.maxTransactionAttempts <= 2,
  };
  const blockedBy = assessAdminTriageActivation(checks).blockedBy;
  return {
    phase: blockedBy.length ? 'BLOCKED' : 'REQUIRES_MANUAL_PRODUCTION_APPROVAL',
    globalOrderingEnabled: false,
    activationAuthorized: false,
    evidenceAuthority: 'UNVERIFIED_OPERATOR_INPUT',
    eligibleForIndependentReview: blockedBy.length === 0,
    checkedAt: now, checks, blockedBy,
    nextStep: blockedBy.length ?
      'Obter evidencias independentes, completas e recentes de producao.' :
      'Validar autenticidade e cobertura da prova externamente; autorizar em etapa separada.',
  };
}
