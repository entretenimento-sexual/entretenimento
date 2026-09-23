import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';

import { db, FieldValue } from '../firebaseApp';
import {
  applyModerationReporterOutcome,
  moderationReporterAbuseRisk,
  normalizeModerationReporterAbuseState,
  type ModerationReporterAbuseRisk,
  type ModerationReporterAbuseState,
} from './moderation-reporter-abuse.policy';

export const MODERATION_REPORTER_ABUSE_COLLECTION =
  'moderation_reporter_abuse_state';

function cleanReporterUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function documentId(reporterUid: string): string {
  return createHash('sha256')
    .update(`reporter:${reporterUid}`)
    .digest('hex');
}

export async function getModerationReporterAbuseRisk(
  reporterUidInput: string
): Promise<ModerationReporterAbuseRisk> {
  const reporterUid = cleanReporterUid(reporterUidInput);
  if (!reporterUid) return 'NORMAL';

  const snapshot = await db
    .collection(MODERATION_REPORTER_ABUSE_COLLECTION)
    .doc(documentId(reporterUid))
    .get();

  const state = normalizeModerationReporterAbuseState({
    state: snapshot.exists
      ? snapshot.data() as Partial<ModerationReporterAbuseState>
      : null,
    nowMs: Date.now(),
  });

  return moderationReporterAbuseRisk(state);
}

export async function recordModerationReporterOutcome(input: {
  reporterUid: string;
  reportId: string;
  confirmed: boolean;
}): Promise<void> {
  const reporterUid = cleanReporterUid(input.reporterUid);
  const reportId = String(input.reportId ?? '').trim().slice(0, 180);

  if (!reporterUid || !reportId) return;

  const nowMs = Date.now();
  const stateRef = db
    .collection(MODERATION_REPORTER_ABUSE_COLLECTION)
    .doc(documentId(reporterUid));
  const eventRef = db
    .collection('moderation_automation_events')
    .doc(createHash('sha256')
      .update(`REPORTER_OUTCOME|${reportId}`)
      .digest('hex')
      .slice(0, 48));

  await db.runTransaction(async (transaction) => {
    const [stateSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(eventRef),
    ]);

    if (eventSnapshot.exists) return;

    const outcome = applyModerationReporterOutcome({
      state: stateSnapshot.exists
        ? stateSnapshot.data() as Partial<ModerationReporterAbuseState>
        : null,
      nowMs,
      confirmed: input.confirmed,
    });

    transaction.set(stateRef, {
      reporterUid,
      ...outcome.state,
      risk: outcome.risk,
      updatedAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });

    transaction.create(eventRef, {
      kind: 'REPORTER_OUTCOME',
      reportId,
      reporterUid,
      confirmed: input.confirmed,
      reporterAbuseRisk: outcome.risk,
      createdAtMs: nowMs,
    });
  });
}

export async function safeRecordModerationReporterOutcome(input: {
  reporterUid: string;
  reportId: string;
  confirmed: boolean;
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
