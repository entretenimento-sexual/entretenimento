// functions/src/authority/event-authority-record.service.ts
// -----------------------------------------------------------------------------
// EVENT AUTHORITY RECORD SERVICE
// -----------------------------------------------------------------------------
// OWNER ÚNICO de escrita do ledger event_authority_records.
//
// Responsabilidades:
// - emitir/reativar autoridade canônica de Evento;
// - revogar sem apagar evidência histórica;
// - manter recibo idempotente e auditoria append-only.
//
// Nenhum domínio social, assinatura pessoal, creatorUid ou role comunitária
// concede autoridade aqui. A autorização para operar este serviço pertence ao
// handler privilegiado; consumidores comuns apenas leem/revalidam o ledger.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import {
  EVENT_AUTHORITY_POLICY_VERSION,
  buildEventAuthorityRecordId,
  type CanonicalEventAuthorityRole,
} from './event-authority.policy';
import {
  normalizeCanonicalAuthorityResourceId,
} from './canonical-resource-authority.model';
import { db } from '../firebaseApp';

export const EVENT_AUTHORITY_RECORDS_COLLECTION = 'event_authority_records';
export const EVENT_AUTHORITY_AUDIT_COLLECTION = 'event_authority_audit';
export const EVENT_AUTHORITY_OPERATIONS_COLLECTION = 'event_authority_operations';

const OPERATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface IssueEventAuthorityInput {
  readonly operationId: string;
  readonly operatorUid: string;
  readonly eventId: string;
  readonly eventLabel: string;
  readonly holderUid: string;
  readonly role: CanonicalEventAuthorityRole;
  readonly sponsorOrganizationId: string | null;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly revalidationDueAt: number | null;
  readonly now?: number;
}

export interface RevokeEventAuthorityInput {
  readonly operationId: string;
  readonly operatorUid: string;
  readonly eventId: string;
  readonly holderUid: string;
  readonly reason: string;
  readonly now?: number;
}

export interface EventAuthorityLifecycleResult {
  readonly recordId: string;
  readonly eventId: string;
  readonly holderUid: string;
  readonly status: 'active' | 'revoked';
  readonly changed: boolean;
}

function cleanId(value: unknown): string | null {
  return normalizeCanonicalAuthorityResourceId(value);
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

function assertOperationReceipt(
  raw: unknown,
  expected: {
    action: 'issue' | 'revoke';
    operatorUid: string;
    recordId: string;
  }
): void {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (
    source['action'] !== expected.action
    || cleanId(source['operatorUid']) !== expected.operatorUid
    || source['recordId'] !== expected.recordId
  ) {
    throw new HttpsError(
      'already-exists',
      'O identificador desta operação de autoridade já foi utilizado.'
    );
  }
}

export async function issueEventAuthorityRecord(
  input: IssueEventAuthorityInput
): Promise<Readonly<EventAuthorityLifecycleResult>> {
  const operationId = cleanOperationId(input.operationId);
  const operatorUid = cleanId(input.operatorUid);
  const eventId = cleanId(input.eventId);
  const holderUid = cleanId(input.holderUid);
  const eventLabel = cleanLabel(input.eventLabel);
  const role = cleanRole(input.role);
  const sponsorOrganizationId = input.sponsorOrganizationId === null
    ? null
    : cleanId(input.sponsorOrganizationId);
  const startsAt = cleanEpoch(input.startsAt);
  const endsAt = cleanEpoch(input.endsAt);
  const revalidationDueAt = input.revalidationDueAt === null
    ? null
    : cleanEpoch(input.revalidationDueAt);
  const now = cleanEpoch(input.now ?? Date.now());

  if (
    !operationId
    || !operatorUid
    || !eventId
    || !holderUid
    || !eventLabel
    || !role
    || (input.sponsorOrganizationId !== null && !sponsorOrganizationId)
    || !startsAt
    || !endsAt
    || !now
    || startsAt >= endsAt
    || endsAt <= now
    || (
      revalidationDueAt !== null
      && (
        revalidationDueAt <= now
        || revalidationDueAt <= startsAt
        || revalidationDueAt >= endsAt
      )
    )
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Os dados da autoridade do Evento são inválidos.'
    );
  }

  const recordId = buildEventAuthorityRecordId(eventId, holderUid);
  if (!recordId) {
    throw new HttpsError(
      'invalid-argument',
      'Evento ou titular inválido para autoridade.'
    );
  }

  const recordRef = db
    .collection(EVENT_AUTHORITY_RECORDS_COLLECTION)
    .doc(recordId);
  const operationRef = db
    .collection(EVENT_AUTHORITY_OPERATIONS_COLLECTION)
    .doc(`issue:${operationId}`);
  const auditRef = db
    .collection(EVENT_AUTHORITY_AUDIT_COLLECTION)
    .doc(`issue:${operationId}`);

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, recordSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(recordRef),
    ]);

    if (operationSnapshot.exists) {
      assertOperationReceipt(operationSnapshot.data(), {
        action: 'issue',
        operatorUid,
        recordId,
      });
      return Object.freeze({
        recordId,
        eventId,
        holderUid,
        status: 'active' as const,
        changed: false,
      });
    }

    const existing = recordSnapshot.exists ? recordSnapshot.data() ?? {} : null;
    if (existing?.['status'] === 'active' && existing?.['revokedAt'] === null) {
      throw new HttpsError(
        'already-exists',
        'Esta autoridade de Evento já está ativa.'
      );
    }

    const createdAt = cleanEpoch(existing?.['createdAt']) ?? now;
    const record = {
      eventId,
      eventLabel,
      eventStatus: 'active',
      holderUid,
      role,
      status: 'active',
      sponsorOrganizationId,
      policyVersion: EVENT_AUTHORITY_POLICY_VERSION,
      startsAt,
      endsAt,
      revalidationDueAt,
      revokedAt: null,
      issuedAt: now,
      issuedBy: operatorUid,
      createdAt,
      updatedAt: now,
    };

    transaction.set(recordRef, record);
    transaction.create(auditRef, {
      action: existing ? 'event_authority_reissued' : 'event_authority_issued',
      recordId,
      eventId,
      holderUid,
      role,
      sponsorOrganizationId,
      operatorUid,
      previousStatus: existing?.['status'] ?? null,
      nextStatus: 'active',
      startsAt,
      endsAt,
      revalidationDueAt,
      policyVersion: EVENT_AUTHORITY_POLICY_VERSION,
      createdAt: now,
    });
    transaction.create(operationRef, {
      action: 'issue',
      operationId,
      operatorUid,
      recordId,
      eventId,
      holderUid,
      status: 'completed',
      createdAt: now,
      expiresAt: new Date(now + OPERATION_RETENTION_MS),
    });

    return Object.freeze({
      recordId,
      eventId,
      holderUid,
      status: 'active' as const,
      changed: true,
    });
  });
}

export async function revokeEventAuthorityRecord(
  input: RevokeEventAuthorityInput
): Promise<Readonly<EventAuthorityLifecycleResult>> {
  const operationId = cleanOperationId(input.operationId);
  const operatorUid = cleanId(input.operatorUid);
  const eventId = cleanId(input.eventId);
  const holderUid = cleanId(input.holderUid);
  const reason = cleanReason(input.reason);
  const now = cleanEpoch(input.now ?? Date.now());

  if (!operationId || !operatorUid || !eventId || !holderUid || !reason || !now) {
    throw new HttpsError(
      'invalid-argument',
      'Os dados de revogação da autoridade do Evento são inválidos.'
    );
  }

  const recordId = buildEventAuthorityRecordId(eventId, holderUid);
  if (!recordId) {
    throw new HttpsError(
      'invalid-argument',
      'Evento ou titular inválido para revogação.'
    );
  }

  const recordRef = db
    .collection(EVENT_AUTHORITY_RECORDS_COLLECTION)
    .doc(recordId);
  const operationRef = db
    .collection(EVENT_AUTHORITY_OPERATIONS_COLLECTION)
    .doc(`revoke:${operationId}`);
  const auditRef = db
    .collection(EVENT_AUTHORITY_AUDIT_COLLECTION)
    .doc(`revoke:${operationId}`);

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, recordSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(recordRef),
    ]);

    if (operationSnapshot.exists) {
      assertOperationReceipt(operationSnapshot.data(), {
        action: 'revoke',
        operatorUid,
        recordId,
      });
      return Object.freeze({
        recordId,
        eventId,
        holderUid,
        status: 'revoked' as const,
        changed: false,
      });
    }

    if (!recordSnapshot.exists) {
      throw new HttpsError(
        'not-found',
        'A autoridade de Evento não foi encontrada.'
      );
    }

    const existing = recordSnapshot.data() ?? {};
    if (
      cleanId(existing['eventId']) !== eventId
      || cleanId(existing['holderUid']) !== holderUid
    ) {
      throw new HttpsError(
        'data-loss',
        'O registro canônico de autoridade está inconsistente.'
      );
    }

    const alreadyRevoked =
      existing['status'] === 'revoked'
      || existing['revokedAt'] !== null;

    if (!alreadyRevoked) {
      transaction.update(recordRef, {
        status: 'revoked',
        revokedAt: now,
        revokedBy: operatorUid,
        revocationReason: reason,
        updatedAt: now,
      });
    }

    transaction.create(auditRef, {
      action: alreadyRevoked
        ? 'event_authority_revoke_noop'
        : 'event_authority_revoked',
      recordId,
      eventId,
      holderUid,
      role: existing['role'] ?? null,
      sponsorOrganizationId: existing['sponsorOrganizationId'] ?? null,
      operatorUid,
      reason,
      previousStatus: existing['status'] ?? null,
      nextStatus: 'revoked',
      policyVersion: existing['policyVersion'] ?? null,
      createdAt: now,
    });
    transaction.create(operationRef, {
      action: 'revoke',
      operationId,
      operatorUid,
      recordId,
      eventId,
      holderUid,
      status: 'completed',
      createdAt: now,
      expiresAt: new Date(now + OPERATION_RETENTION_MS),
    });

    return Object.freeze({
      recordId,
      eventId,
      holderUid,
      status: 'revoked' as const,
      changed: !alreadyRevoked,
    });
  });
}
