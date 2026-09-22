// functions/src/moderation/moderation-automation-event.model.ts
// -----------------------------------------------------------------------------
// MODERATION AUTOMATION EVENT MODEL
// -----------------------------------------------------------------------------

export type ModerationAutomationEventKind =
  | 'REPORT_OPENED'
  | 'REPORT_CLOSED';

export function isCriticalModerationSafetyReason(
  value: unknown
): boolean {
  const reason = String(value ?? '').trim().toLowerCase();
  return reason === 'minor_safety' ||
    reason === 'minor_content_safety';
}

export function resolveModerationAutomationSubjectUid(
  report: Record<string, unknown>
): string | null {
  const candidates = [
    report['targetAuthorUid'],
    report['targetOwnerUid'],
    report['targetType'] === 'profile' ? report['targetId'] : null,
  ];

  for (const candidate of candidates) {
    const uid = String(candidate ?? '').trim();
    if (/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
      return uid;
    }
  }

  return null;
}

export function isTerminalModerationReportStatus(
  value: unknown
): boolean {
  const status = String(value ?? '').trim().toLowerCase();
  return status === 'resolved' || status === 'rejected';
}

export function isConfirmedModerationViolation(
  report: Record<string, unknown>
): boolean {
  return String(report['moderationAction'] ?? '')
    .trim()
    .toUpperCase() === 'REMOVE';
}
