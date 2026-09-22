// functions/src/moderation/moderation-automation-events.trigger.ts
// -----------------------------------------------------------------------------
// MODERATION AUTOMATION SHADOW TELEMETRY
// -----------------------------------------------------------------------------
// Registra sinais backend-only sem aplicar lifecycle. Eventos são idempotentes
// e alimentam calibração futura de quarentena, hold e suspensão automáticos.
// -----------------------------------------------------------------------------

import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  isConfirmedModerationViolation,
  isCriticalModerationSafetyReason,
  isTerminalModerationReportStatus,
  resolveModerationAutomationSubjectUid,
} from './moderation-automation-event.model';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,180}$/.test(normalized) ? normalized : '';
}

async function createAutomationEvent(
  eventId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const eventRef = db
    .collection('moderation_automation_events')
    .doc(eventId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventRef);
    if (snapshot.exists) {
      return;
    }

    transaction.create(eventRef, {
      ...payload,
      policyVersion: 1,
      automationMode: 'SHADOW',
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
    });
  });
}

export const onModerationReportOpenedAutomationSignal =
  onDocumentCreated(
    {
      document: 'moderation_reports/{reportId}',
      region: FUNCTIONS_REGION,
    },
    async (event) => {
      const reportId = cleanId(event.params['reportId']);
      const snapshot = event.data;

      if (!reportId || !snapshot?.exists) {
        return;
      }

      const report = snapshot.data() ?? {};
      const subjectUid =
        resolveModerationAutomationSubjectUid(report);

      await createAutomationEvent(
        `${reportId}:opened`,
        {
          kind: 'REPORT_OPENED',
          reportId,
          reporterUid: cleanId(report['reporterUid']) || null,
          subjectUid,
          targetType: String(report['targetType'] ?? '').trim() || null,
          targetId: cleanId(report['targetId']) || null,
          reason: String(report['reason'] ?? '').trim() || null,
          criticalSafety:
            isCriticalModerationSafetyReason(report['reason']),
          contentQuarantined: report['contentQuarantined'] === true,
          source: 'moderation_reports',
        }
      );
    }
  );

export const onModerationReportClosedAutomationSignal =
  onDocumentUpdated(
    {
      document: 'moderation_reports/{reportId}',
      region: FUNCTIONS_REGION,
    },
    async (event) => {
      const reportId = cleanId(event.params['reportId']);
      const before = event.data?.before.data() ?? null;
      const after = event.data?.after.data() ?? null;

      if (!reportId || !before || !after) {
        return;
      }

      if (
        isTerminalModerationReportStatus(before['status']) ||
        !isTerminalModerationReportStatus(after['status'])
      ) {
        return;
      }

      const subjectUid =
        resolveModerationAutomationSubjectUid(after);
      const confirmedViolation =
        isConfirmedModerationViolation(after);
      const criticalSafety =
        isCriticalModerationSafetyReason(after['reason']);

      await createAutomationEvent(
        `${reportId}:closed`,
        {
          kind: 'REPORT_CLOSED',
          reportId,
          reporterUid: cleanId(after['reporterUid']) || null,
          subjectUid,
          targetType: String(after['targetType'] ?? '').trim() || null,
          targetId: cleanId(after['targetId']) || null,
          reason: String(after['reason'] ?? '').trim() || null,
          finalStatus: String(after['status'] ?? '').trim() || null,
          moderationAction:
            String(after['moderationAction'] ?? '').trim() || null,
          criticalSafety,
          confirmedViolation,
          confirmedCriticalViolation:
            confirmedViolation && criticalSafety,
          contentQuarantined: after['contentQuarantined'] === true,
          source: 'moderation_reports',
        }
      );
    }
  );
