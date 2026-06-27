// src/app/admin-dashboard/moderation-reports/moderation-report-age.util.ts
import { AdminModerationReportVm } from 'src/app/core/services/moderation/admin-moderation-report.service';

const OPEN_PRIORITY_THRESHOLD_MS = 48 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function moderationReportDateValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;

  const withToDate = value as { toDate?: () => Date };
  if (typeof withToDate.toDate === 'function') {
    return withToDate.toDate();
  }

  const withSeconds = value as { seconds?: number };
  if (typeof withSeconds.seconds === 'number') {
    return new Date(withSeconds.seconds * 1000);
  }

  return null;
}

export function isAgedOpenModerationReport(report: AdminModerationReportVm): boolean {
  if (report.status !== 'open') {
    return false;
  }

  const createdAt = moderationReportDateValue(report.createdAt);
  if (!createdAt) {
    return false;
  }

  return Date.now() - createdAt.getTime() >= OPEN_PRIORITY_THRESHOLD_MS;
}

export function agedOpenModerationReportLabel(report: AdminModerationReportVm): string | null {
  if (!isAgedOpenModerationReport(report)) {
    return null;
  }

  const createdAt = moderationReportDateValue(report.createdAt);
  if (!createdAt) {
    return '48h+ aberta';
  }

  const days = Math.max(1, Math.floor((Date.now() - createdAt.getTime()) / ONE_DAY_MS));
  return days === 1 ? 'Aberta há 1 dia' : `Aberta há ${days} dias`;
}
