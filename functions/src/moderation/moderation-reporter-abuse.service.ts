// functions/src/moderation/moderation-reporter-abuse.service.ts
// -----------------------------------------------------------------------------
// MODERATION REPORTER ABUSE SERVICE
// -----------------------------------------------------------------------------
// Backend-only reporter quality signals. The state is intentionally separate
// from target enforcement: it can only tune rate limits and queue metadata.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';

import { db, FieldValue } from '../firebaseApp';
import {
  evaluateModerationReporterAbuse,
  type ModerationReporterAbuseAssessment,
  type ModerationReporterAbuseSignals,
} from './moderation-reporter-abuse.policy';

const WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const STATE_COLLECTION = 'moderation_reporter_abuse_state';
const OUTCOME_COLLECTION = 'moderation_reporter_abuse_outcomes';

export type ModerationReporterOutcome = 'REJECTED' | 'CONFIRMED';

interface ReporterAbuseState extends ModerationReporterAbuseSignals {
  windowStartedAtMs?: unknown;
}

interface ReporterOutcomeDocument {
  reporterUid?: unknown;
  outcome?: unknown;
  windowStartedAtMs?: unknown;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,180}$/.test(normalized) ? normalized : '';
}

function safeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function currentWindowStartedAt(nowMs: number): number {
  return Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
}

function normalizeSignals(
  data: ReporterAbuseState | undefined,
  expectedWindowStartedAtMs: number
): ModerationReporterAbuseSignals {
  if (
    Number(data?.windowStartedAtMs ?? 0) !== expectedWindowStartedAtMs
  ) {
    return {
      reviewedReports: 0,
      rejectedReports: 0,
      confirmedReports: 0,
    };
  }

  return {
    reviewedReports: safeCount(data?.reviewedReports),
    rejectedReports: safeCount(data?.rejectedReports),
    confirmedReports: safeCount(data?.confirmedReports),
  };
}

function outcomeId(reportId: string): string {
  return createHash('sha256')
    .update(reportId)
    .digest('hex')
    .slice(0, 48);
}

export async function getModerationReporterAbuseAssessment(
  reporterUidInput: string,
  nowMs = Date.now()
): Promise<Readonly<ModerationReporterAbuseAssessment>> {
  const reporterUid = cleanId(reporterUidInput);

  if (!reporterUid) {
    return evaluateModerationReporterAbuse({
      reviewedReports: 0,
      rejectedReports: 0,
      confirmedReports: 0,
    });
  }

  const windowStartedAtMs = currentWindowStartedAt(nowMs);
  const snapshot = await db
    .collection(STATE_COLLECTION)
    .doc(reporterUid)
    .get();
  const signals = normalizeSignals(
    snapshot.exists
      ? snapshot.data() as ReporterAbuseState
      : undefined,
    windowStartedAtMs
  );

  return evaluateModerationReporterAbuse(signals);
}

export async function safeGetModerationReporterAbuseAssessment(
  reporterUid: string
): Promise<Readonly<ModerationReporterAbuseAssessment>> {
  try {
    return await getModerationReporterAbuseAssessment(reporterUid);
  } catch (error) {
    logger.error('[moderationReporterAbuse] assessment failed', {
      reporterUid,
      error: error instanceof Error ? error.message : String(error),
    });

    return evaluateModerationReporterAbuse({
      reviewedReports: 0,
      rejectedReports: 0,
      confirmedReports: 0,
    });
  }
}

export async function recordModerationReporterOutcome(input: {
  reportId: string;
  reporterUid: string;
  outcome: ModerationReporterOutcome;
  nowMs?: number;
}): Promise<void> {
  const reportId = cleanId(input.reportId);
  const reporterUid = cleanId(input.reporterUid);
  const outcome = input.outcome;
  const nowMs = Number.isFinite(input.nowMs)
    ? Math.trunc(input.nowMs as number)
    : Date.now();

  if (!reportId || !reporterUid) return;

  const windowStartedAtMs = currentWindowStartedAt(nowMs);
  const stateRef = db.collection(STATE_COLLECTION).doc(reporterUid);
  const outcomeRef = db.collection(OUTCOME_COLLECTION).doc(outcomeId(reportId));

  await db.runTransaction(async (transaction) => {
    const [stateSnapshot, outcomeSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(outcomeRef),
    ]);
    const current = normalizeSignals(
      stateSnapshot.exists
        ? stateSnapshot.data() as ReporterAbuseState
        : undefined,
      windowStartedAtMs
    );
    const previous = outcomeSnapshot.exists
      ? outcomeSnapshot.data() as ReporterOutcomeDocument
      : null;
    const previousOutcome = String(previous?.outcome ?? '').trim();
    const previousWindowStartedAtMs = Number(
      previous?.windowStartedAtMs ?? 0
    );
    const previousBelongsToCurrentWindow =
      previousWindowStartedAtMs === windowStartedAtMs &&
      cleanId(previous?.reporterUid) === reporterUid;

    let reviewedReports = current.reviewedReports;
    let rejectedReports = current.rejectedReports;
    let confirmedReports = current.confirmedReports;

    if (!previousBelongsToCurrentWindow) {
      reviewedReports += 1;
    } else if (previousOutcome === outcome) {
      return;
    } else if (previousOutcome === 'REJECTED') {
      rejectedReports = Math.max(0, rejectedReports - 1);
    } else if (previousOutcome === 'CONFIRMED') {
      confirmedReports = Math.max(0, confirmedReports - 1);
    }

    if (outcome === 'REJECTED') {
      rejectedReports += 1;
    } else {
      confirmedReports += 1;
    }

    transaction.set(
      stateRef,
      {
        reporterUid,
        windowStartedAtMs,
        windowEndsAtMs: windowStartedAtMs + WINDOW_MS,
        reviewedReports,
        rejectedReports,
        confirmedReports,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );

    transaction.set(
      outcomeRef,
      {
        reportId,
        reporterUid,
        outcome,
        windowStartedAtMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
  });
}

export async function safeRecordModerationReporterOutcome(input: {
  reportId: string;
  reporterUid: string;
  outcome: ModerationReporterOutcome;
}): Promise<void> {
  try {
    await recordModerationReporterOutcome(input);
  } catch (error) {
    logger.error('[moderationReporterAbuse] outcome signal failed', {
      reportId: input.reportId,
      reporterUid: input.reporterUid,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const MODERATION_REPORTER_ABUSE_WINDOW_MS = WINDOW_MS;
