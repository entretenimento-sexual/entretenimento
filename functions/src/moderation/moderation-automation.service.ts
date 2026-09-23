// functions/src/moderation/moderation-automation.service.ts
import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';

import {
  UserDoc,
  createLifecycleAudit,
  getNicknameIndexDocId,
} from '../account_lifecycle/_shared';
import { db, FieldValue, Timestamp } from '../firebaseApp';
import {
  DEFAULT_MODERATION_AUTOMATION_THRESHOLDS,
  evaluateModerationAutomation,
  type ModerationAutomationDecision,
  type ModerationAutomationMode,
  type ModerationAutomationSignals,
} from './moderation-automation.policy';

const WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const INTERACTION_HOLD_MS = 24 * 60 * 60 * 1_000;

export interface ModerationOpenSignalInput {
  reportId: string;
  targetUid: string;
  reporterUid: string;
  targetKey: string;
  critical: boolean;
  quarantined: boolean;
}

export interface ModerationReviewSignalInput {
  reportId: string;
  targetUid: string;
  critical: boolean;
  confirmed: boolean;
}

interface ModerationAutomationState extends ModerationAutomationSignals {
  targetUid?: string;
  windowId?: string;
}

interface OpenAutomationEvent {
  stateId?: string;
  critical?: boolean;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,180}$/.test(normalized) ? normalized : '';
}

function cleanTargetKey(value: unknown): string {
  return String(value ?? '').trim().slice(0, 800);
}

function hashId(...parts: string[]): string {
  return createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 48);
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : 0;
}

function resolveMode(): ModerationAutomationMode {
  return String(process.env.MODERATION_AUTOMATION_MODE ?? 'SHADOW')
    .trim()
    .toUpperCase() === 'ENFORCE'
    ? 'ENFORCE'
    : 'SHADOW';
}

function windowFor(nowMs: number) {
  const bucket = Math.floor(nowMs / WINDOW_MS);
  const startedAtMs = bucket * WINDOW_MS;

  return {
    windowId: String(bucket),
    startedAtMs,
    endsAtMs: startedAtMs + WINDOW_MS,
  };
}

function normalizeSignals(
  raw: ModerationAutomationState | undefined
): ModerationAutomationSignals {
  return {
    openReports: count(raw?.openReports),
    openCriticalReports: count(raw?.openCriticalReports),
    quarantinedDistinctTargets: count(raw?.quarantinedDistinctTargets),
    uniqueReporters: count(raw?.uniqueReporters),
    confirmedViolations: count(raw?.confirmedViolations),
    confirmedCriticalViolations: count(raw?.confirmedCriticalViolations),
  };
}

function priorityFor(
  decision: ModerationAutomationDecision,
  critical: boolean
): 'NORMAL' | 'HIGH' | 'CRITICAL' {
  if (critical || decision.reason === 'confirmed_critical') return 'CRITICAL';
  return decision.action === 'NONE' ? 'NORMAL' : 'HIGH';
}

async function applyTemporaryInteractionHold(input: {
  targetUid: string;
  reportId: string;
  decision: ModerationAutomationDecision;
  nowMs: number;
}): Promise<void> {
  const userRef = db.collection('users').doc(input.targetUid);
  const notificationRef = db
    .collection('notifications')
    .doc(`moderation_auto_hold_${input.targetUid}_${input.reportId}`);

  await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) return;

    const user = (userSnapshot.data() ?? {}) as UserDoc & {
      moderationAutomationHold?: {
        active?: boolean;
        expiresAtMs?: number | null;
      };
    };

    if (
      String(user.accountStatus ?? 'active') !== 'active' ||
      user.suspended === true
    ) {
      return;
    }

    const currentExpiry = Number(
      user.moderationAutomationHold?.expiresAtMs ?? 0
    );
    const expiresAtMs = Math.max(
      Number.isFinite(currentExpiry) ? currentExpiry : 0,
      input.nowMs + INTERACTION_HOLD_MS
    );

    transaction.set(
      userRef,
      {
        moderationAutomationHold: {
          active: true,
          source: 'automation',
          reason: input.decision.reason,
          triggerReportId: input.reportId,
          appliedAtMs: input.nowMs,
          expiresAtMs,
          expiresAt: Timestamp.fromMillis(expiresAtMs),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    transaction.set(
      notificationRef,
      {
        userId: input.targetUid,
        type: 'compliance.action.taken',
        title: 'Interações temporariamente limitadas',
        body:
          'Algumas interações foram temporariamente limitadas enquanto sinais de segurança são revisados.',
        route: '/conta/status',
        actionRequired: true,
        readAt: null,
        createdAt: input.nowMs,
        updatedAt: input.nowMs,
      },
      { merge: true }
    );

    createLifecycleAudit(transaction, {
      uid: input.targetUid,
      actorUid: 'system:moderation-automation',
      action: 'moderation_automation_interaction_hold',
      accountStatus: 'active',
      source: 'automation',
      triggerReportId: input.reportId,
      reason: input.decision.reason,
      expiresAtMs,
      createdAt: input.nowMs,
      updatedAt: input.nowMs,
    });
  });
}

async function applyConfirmedAutomaticSuspension(input: {
  targetUid: string;
  reportId: string;
  decision: ModerationAutomationDecision;
  critical: boolean;
  nowMs: number;
}): Promise<void> {
  const userRef = db.collection('users').doc(input.targetUid);
  const publicProfileRef = db.collection('public_profiles').doc(input.targetUid);
  const notificationRef = db
    .collection('notifications')
    .doc(`moderation_auto_suspend_${input.targetUid}_${input.reportId}`);

  await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) return;

    const user = (userSnapshot.data() ?? {}) as UserDoc;
    const currentStatus = String(user.accountStatus ?? 'active');

    if (
      currentStatus === 'deleted' ||
      currentStatus === 'pending_deletion' ||
      currentStatus === 'moderation_suspended'
    ) {
      return;
    }

    const nicknameIndexDocId = getNicknameIndexDocId(user);
    const reason = input.critical
      ? 'Suspensão automática após confirmação de violação crítica envolvendo segurança de menores.'
      : 'Suspensão automática após reincidência de violações confirmadas pela moderação.';

    transaction.set(
      userRef,
      {
        accountStatus: 'moderation_suspended',
        publicVisibility: 'hidden',
        interactionBlocked: true,
        loginAllowed: true,
        suspended: true,
        suspensionReason: reason,
        suspensionSource: 'automation',
        suspensionEndsAt: null,
        suspendedAtMs: input.nowMs,
        suspendedBy: 'system:moderation-automation',
        statusUpdatedAt: input.nowMs,
        statusUpdatedBy: 'system:moderation-automation',
        moderationAutomationHold: {
          active: false,
          source: 'automation',
          reason: input.decision.reason,
          triggerReportId: input.reportId,
          appliedAtMs: input.nowMs,
          expiresAtMs: null,
          expiresAt: null,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    transaction.delete(publicProfileRef);

    if (nicknameIndexDocId) {
      transaction.delete(
        db.collection('public_index').doc(nicknameIndexDocId)
      );
    }

    transaction.set(
      notificationRef,
      {
        userId: input.targetUid,
        type: 'compliance.action.taken',
        title: 'Conta suspensa por segurança',
        body: [
          'A conta foi suspensa após confirmação de violações de segurança.',
          'Consulte o status da conta e os canais de revisão.',
        ].join(' '),
        route: '/conta/status',
        actionRequired: true,
        readAt: null,
        createdAt: input.nowMs,
        updatedAt: input.nowMs,
      },
      { merge: true }
    );

    createLifecycleAudit(transaction, {
      uid: input.targetUid,
      actorUid: 'system:moderation-automation',
      action: 'moderation_automation_suspend_confirmed',
      previousAccountStatus: currentStatus,
      accountStatus: 'moderation_suspended',
      source: 'automation',
      triggerReportId: input.reportId,
      reason: input.decision.reason,
      critical: input.critical,
      createdAt: input.nowMs,
      updatedAt: input.nowMs,
    });
  });
}

export async function recordModerationOpenSignal(
  input: ModerationOpenSignalInput
): Promise<ModerationAutomationDecision | null> {
  const reportId = cleanId(input.reportId);
  const targetUid = cleanId(input.targetUid);
  const reporterUid = cleanId(input.reporterUid);
  const targetKey = cleanTargetKey(input.targetKey);

  if (!reportId || !targetUid || !reporterUid || !targetKey) return null;

  const nowMs = Date.now();
  const window = windowFor(nowMs);
  const stateId = `${targetUid}_${window.windowId}`;
  const stateRef = db.collection('moderation_automation_state').doc(stateId);
  const eventRef = db
    .collection('moderation_automation_events')
    .doc(hashId('OPEN', reportId));
  const reporterRef = db
    .collection('moderation_automation_reporters')
    .doc(hashId(stateId, reporterUid));
  const targetRef = db
    .collection('moderation_automation_targets')
    .doc(hashId(stateId, targetKey));
  const reportRef = db.collection('moderation_reports').doc(reportId);
  const mode = resolveMode();

  const result = await db.runTransaction(async (transaction) => {
    const [
      eventSnapshot,
      stateSnapshot,
      reporterSnapshot,
      targetSnapshot,
    ] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(stateRef),
      transaction.get(reporterRef),
      transaction.get(targetRef),
    ]);

    const existing = normalizeSignals(
      stateSnapshot.exists
        ? stateSnapshot.data() as ModerationAutomationState
        : undefined
    );

    if (eventSnapshot.exists) {
      return {
        created: false,
        decision: evaluateModerationAutomation({ mode, signals: existing }),
      };
    }

    const next: ModerationAutomationSignals = {
      ...existing,
      openReports: existing.openReports + 1,
      openCriticalReports:
        existing.openCriticalReports + (input.critical ? 1 : 0),
      uniqueReporters:
        existing.uniqueReporters + (reporterSnapshot.exists ? 0 : 1),
      quarantinedDistinctTargets:
        existing.quarantinedDistinctTargets +
        (input.quarantined && !targetSnapshot.exists ? 1 : 0),
    };
    const decision = evaluateModerationAutomation({ mode, signals: next });

    transaction.set(stateRef, {
      targetUid,
      windowId: window.windowId,
      windowStartedAtMs: window.startedAtMs,
      windowEndsAtMs: window.endsAtMs,
      ...next,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (!reporterSnapshot.exists) {
      transaction.create(reporterRef, {
        stateId,
        targetUid,
        reporterUid,
        createdAtMs: nowMs,
      });
    }

    if (input.quarantined && !targetSnapshot.exists) {
      transaction.create(targetRef, {
        stateId,
        targetUid,
        targetKey,
        createdAtMs: nowMs,
      });
    }

    transaction.create(eventRef, {
      kind: 'OPEN',
      reportId,
      stateId,
      targetUid,
      critical: input.critical,
      quarantined: input.quarantined,
      createdAtMs: nowMs,
    });

    transaction.set(reportRef, {
      automationPriority: priorityFor(decision, input.critical),
      automationDecision: decision.action,
      automationReason: decision.reason,
      automationMode: mode,
      automationWindowId: window.windowId,
      automationEvaluatedAtMs: nowMs,
    }, { merge: true });

    return { created: true, decision };
  });

  if (
    result.created &&
    result.decision.action === 'TEMPORARY_INTERACTION_HOLD' &&
    result.decision.enforce
  ) {
    await applyTemporaryInteractionHold({
      targetUid,
      reportId,
      decision: result.decision,
      nowMs,
    });
  }

  return result.decision;
}

export async function recordModerationReviewSignal(
  input: ModerationReviewSignalInput
): Promise<ModerationAutomationDecision | null> {
  const reportId = cleanId(input.reportId);
  const targetUid = cleanId(input.targetUid);
  if (!reportId || !targetUid) return null;

  const nowMs = Date.now();
  const openEventRef = db
    .collection('moderation_automation_events')
    .doc(hashId('OPEN', reportId));
  const reviewEventRef = db
    .collection('moderation_automation_events')
    .doc(hashId('REVIEW', reportId));
  const mode = resolveMode();

  const result = await db.runTransaction(async (transaction) => {
    const [openEventSnapshot, reviewEventSnapshot] = await Promise.all([
      transaction.get(openEventRef),
      transaction.get(reviewEventRef),
    ]);
    const openEvent = openEventSnapshot.exists
      ? openEventSnapshot.data() as OpenAutomationEvent
      : {};
    const reviewEvent = reviewEventSnapshot.exists
      ? reviewEventSnapshot.data() ?? {}
      : {};
    const fallbackWindow = windowFor(nowMs);
    const stateId =
      cleanId(reviewEvent['stateId']) ||
      cleanId(openEvent.stateId) ||
      `${targetUid}_${fallbackWindow.windowId}`;
    const stateRef = db.collection('moderation_automation_state').doc(stateId);
    const stateSnapshot = await transaction.get(stateRef);
    const existing = normalizeSignals(
      stateSnapshot.exists
        ? stateSnapshot.data() as ModerationAutomationState
        : undefined
    );
    const critical = reviewEventSnapshot.exists
      ? reviewEvent['critical'] === true
      : openEventSnapshot.exists
        ? openEvent.critical === true
        : input.critical;
    const previousConfirmed = reviewEventSnapshot.exists
      ? reviewEvent['confirmed'] === true
      : null;

    if (
      reviewEventSnapshot.exists &&
      previousConfirmed === input.confirmed
    ) {
      return {
        changed: false,
        decision: evaluateModerationAutomation({
          mode,
          signals: existing,
        }),
      };
    }

    const next: ModerationAutomationSignals = reviewEventSnapshot.exists
      ? {
        ...existing,
        confirmedViolations: Math.max(
          0,
          existing.confirmedViolations +
            (input.confirmed ? 1 : -1)
        ),
        confirmedCriticalViolations: critical
          ? Math.max(
            0,
            existing.confirmedCriticalViolations +
              (input.confirmed ? 1 : -1)
          )
          : existing.confirmedCriticalViolations,
      }
      : {
        ...existing,
        openReports: Math.max(0, existing.openReports - 1),
        openCriticalReports: Math.max(
          0,
          existing.openCriticalReports - (critical ? 1 : 0)
        ),
        confirmedViolations:
          existing.confirmedViolations + (input.confirmed ? 1 : 0),
        confirmedCriticalViolations:
          existing.confirmedCriticalViolations +
          (input.confirmed && critical ? 1 : 0),
      };
    const decision = evaluateModerationAutomation({ mode, signals: next });

    transaction.set(stateRef, {
      targetUid,
      ...next,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (reviewEventSnapshot.exists) {
      transaction.set(
        reviewEventRef,
        {
          confirmed: input.confirmed,
          decision: decision.action,
          decisionReason: decision.reason,
          enforce: decision.enforce,
          revisedAtMs: nowMs,
        },
        { merge: true }
      );
    } else {
      transaction.create(reviewEventRef, {
        kind: 'REVIEW',
        reportId,
        stateId,
        targetUid,
        critical,
        confirmed: input.confirmed,
        decision: decision.action,
        decisionReason: decision.reason,
        enforce: decision.enforce,
        createdAtMs: nowMs,
      });
    }

    transaction.set(
      db.collection('moderation_reports').doc(reportId),
      {
        automationDecision: decision.action,
        automationReason: decision.reason,
        automationMode: mode,
        automationEvaluatedAtMs: nowMs,
      },
      { merge: true }
    );

    return { changed: true, decision };
  });

  if (
    result.changed &&
    result.decision.action === 'SUSPEND_CONFIRMED' &&
    result.decision.enforce &&
    input.confirmed
  ) {
    await applyConfirmedAutomaticSuspension({
      targetUid,
      reportId,
      decision: result.decision,
      critical: input.critical,
      nowMs,
    });
  }

  return result.decision;
}

export async function safeRecordModerationOpenSignal(
  input: ModerationOpenSignalInput
): Promise<void> {
  try {
    await recordModerationOpenSignal(input);
  } catch (error) {
    logger.error('[moderationAutomation] open signal failed', {
      reportId: input.reportId,
      targetUid: input.targetUid,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function safeRecordModerationReviewSignal(
  input: ModerationReviewSignalInput
): Promise<void> {
  try {
    await recordModerationReviewSignal(input);
  } catch (error) {
    logger.error('[moderationAutomation] review signal failed', {
      reportId: input.reportId,
      targetUid: input.targetUid,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const MODERATION_AUTOMATION_WINDOW_MS = WINDOW_MS;
export const MODERATION_AUTOMATION_THRESHOLDS =
  DEFAULT_MODERATION_AUTOMATION_THRESHOLDS;
