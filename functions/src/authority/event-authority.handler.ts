// functions/src/authority/event-authority.handler.ts
// -----------------------------------------------------------------------------
// EVENT AUTHORITY LIFECYCLE HANDLERS
// -----------------------------------------------------------------------------
// Entry points privilegiados do ledger canônico de autoridade de Evento.
//
// Handler autentica operador; EventAuthorityRecordService é o único writer.
// Nenhuma role de Comunidade, assinatura ou atributo público do Evento concede
// organizer/promoter/responsible.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import type { CanonicalEventAuthorityRole } from './event-authority.policy';
import {
  issueEventAuthorityRecord,
  revokeEventAuthorityRecord,
  type EventAuthorityLifecycleResult,
} from './event-authority-record.service';

interface IssueEventAuthorityRequest {
  operationId?: unknown;
  eventId?: unknown;
  eventLabel?: unknown;
  holderUid?: unknown;
  role?: unknown;
  sponsorOrganizationId?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  revalidationDueAt?: unknown;
}

interface RevokeEventAuthorityRequest {
  operationId?: unknown;
  eventId?: unknown;
  holderUid?: unknown;
  reason?: unknown;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanOperationId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{12,96}$/.test(normalized) ? normalized : null;
}

function cleanLabel(value: unknown): string | null {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return normalized.length >= 2 ? normalized : null;
}

function cleanReason(value: unknown): string | null {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return normalized.length >= 3 ? normalized : null;
}

function cleanRole(value: unknown): CanonicalEventAuthorityRole | null {
  return value === 'organizer'
    || value === 'promoter'
    || value === 'responsible'
    ? value
    : null;
}

function cleanEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function assertAuthorityOperator(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const operatorUid = cleanId(auth?.uid);
  const token = auth?.token ?? {};
  const roles = Array.isArray(token['roles'])
    ? token['roles'].map((role) => String(role ?? '').trim().toLowerCase())
    : [];
  const allowed =
    token['superadmin'] === true
    || token['admin'] === true
    || token['role'] === 'admin'
    || roles.includes('superadmin')
    || roles.includes('admin');

  if (!operatorUid) {
    throw new HttpsError(
      'unauthenticated',
      'Operador de autoridade não autenticado.'
    );
  }
  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Somente a administração pode emitir ou revogar autoridade de Evento.'
    );
  }

  return operatorUid;
}

export const issueEventAuthority = onCall<IssueEventAuthorityRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<EventAuthorityLifecycleResult> => {
    assertCallableAppCheck(request.app);
    const operatorUid = assertAuthorityOperator(request.auth);
    assertRecentAuthentication(request.auth?.token);

    const operationId = cleanOperationId(request.data?.operationId);
    const eventId = cleanId(request.data?.eventId);
    const eventLabel = cleanLabel(request.data?.eventLabel);
    const holderUid = cleanId(request.data?.holderUid);
    const role = cleanRole(request.data?.role);
    const sponsorRaw = request.data?.sponsorOrganizationId;
    const sponsorOrganizationId =
      sponsorRaw === null || sponsorRaw === undefined || sponsorRaw === ''
        ? null
        : cleanId(sponsorRaw);
    const now = Date.now();
    const startsAt = request.data?.startsAt === undefined
      ? now
      : cleanEpoch(request.data.startsAt);
    const endsAt = cleanEpoch(request.data?.endsAt);
    const revalidationDueAt =
      request.data?.revalidationDueAt === null
      || request.data?.revalidationDueAt === undefined
        ? null
        : cleanEpoch(request.data.revalidationDueAt);

    if (
      !operationId
      || !eventId
      || !eventLabel
      || !holderUid
      || !role
      || !startsAt
      || !endsAt
      || (
        sponsorRaw !== null
        && sponsorRaw !== undefined
        && sponsorRaw !== ''
        && !sponsorOrganizationId
      )
      || (
        request.data?.revalidationDueAt !== null
        && request.data?.revalidationDueAt !== undefined
        && !revalidationDueAt
      )
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Revise os dados da autoridade do Evento.'
      );
    }

    return issueEventAuthorityRecord({
      operationId,
      operatorUid,
      eventId,
      eventLabel,
      holderUid,
      role,
      sponsorOrganizationId,
      startsAt,
      endsAt,
      revalidationDueAt,
      now,
    });
  }
);

export const revokeEventAuthority = onCall<RevokeEventAuthorityRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<EventAuthorityLifecycleResult> => {
    assertCallableAppCheck(request.app);
    const operatorUid = assertAuthorityOperator(request.auth);
    assertRecentAuthentication(request.auth?.token);

    const operationId = cleanOperationId(request.data?.operationId);
    const eventId = cleanId(request.data?.eventId);
    const holderUid = cleanId(request.data?.holderUid);
    const reason = cleanReason(request.data?.reason);

    if (!operationId || !eventId || !holderUid || !reason) {
      throw new HttpsError(
        'invalid-argument',
        'Revise os dados de revogação da autoridade do Evento.'
      );
    }

    return revokeEventAuthorityRecord({
      operationId,
      operatorUid,
      eventId,
      holderUid,
      reason,
    });
  }
);
