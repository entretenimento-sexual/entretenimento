import { createHash } from 'node:crypto';

import { HttpsError } from 'firebase-functions/v2/https';

import {
  UserDoc,
  assertStaffAuthorization,
} from '../account_lifecycle/_shared';
import { isProfileMinorSafetyReport } from './profile-age-reverification.policy';

export interface ModerationReportDocument {
  reporterUid?: string;
  targetType?: string;
  targetId?: string;
  targetOwnerUid?: string;
  reason?: string;
  status?: string;
  ageReverificationCaseId?: string | null;
  ageReverificationStatus?: string | null;
}

export interface AgeReverificationRecord {
  status?: string;
  caseId?: string | null;
  reportId?: string | null;
  source?: string | null;
  requestedAt?: number | null;
  dueAt?: number | null;
  submittedAt?: number | null;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  result?: string | null;
  method?: string | null;
  declaredAgeBand?: string | null;
  resolution?: string | null;
}

export interface AgeReverificationUserDocument extends UserDoc {
  ageReverification?: AgeReverificationRecord | null;
  suspended?: boolean;
}

export function cleanComplianceId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

export function cleanComplianceText(
  value: unknown,
  maxLength: number
): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function cleanComplianceRoute(value: unknown): string | null {
  const route = cleanComplianceText(value, 300);
  return route.startsWith('/') && !route.startsWith('//') ? route : null;
}

export function profileMinorReportDedupId(
  reporterUid: string,
  targetUid: string
): string {
  return `profile_minor_${createHash('sha256')
    .update(`${reporterUid}:${targetUid}`)
    .digest('hex')}`;
}

export function assertComplianceAuthenticatedUid(
  requestAuth: unknown
): string {
  const auth = requestAuth as { uid?: unknown } | null | undefined;
  const uid = cleanComplianceId(auth?.uid);

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Entre novamente para continuar.');
  }

  return uid;
}

export async function assertComplianceModerator(
  requestAuth: unknown
): Promise<string> {
  const auth = requestAuth as {
    uid?: unknown;
    token?: Record<string, unknown>;
  } | null | undefined;
  const actorUid = cleanComplianceId(auth?.uid);

  await assertStaffAuthorization({
    actorUid: actorUid || null,
    authToken: auth?.token ?? {},
    requiredPermission: 'users:suspend',
  });

  return actorUid;
}

export function reportTargetUid(
  report: ModerationReportDocument
): string {
  return cleanComplianceId(report.targetOwnerUid) ||
    cleanComplianceId(report.targetId);
}

export function assertMinorProfileReport(
  report: ModerationReportDocument
): string {
  if (!isProfileMinorSafetyReport(report)) {
    throw new HttpsError(
      'failed-precondition',
      'A revalidação só pode partir de denúncia de perfil por possível menoridade.'
    );
  }

  const targetUid = reportTargetUid(report);

  if (!targetUid) {
    throw new HttpsError(
      'failed-precondition',
      'Perfil denunciado inválido.'
    );
  }

  return targetUid;
}

export function normalizeAgeReverificationStatus(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function isOpenReportStatus(value: unknown): boolean {
  const status = String(value ?? '').trim().toLowerCase();
  return status === 'open' || status === 'reviewing';
}
