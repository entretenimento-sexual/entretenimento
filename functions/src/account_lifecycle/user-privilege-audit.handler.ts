// functions/src/account_lifecycle/user-privilege-audit.handler.ts
// -----------------------------------------------------------------------------
// USER PRIVILEGE AUDIT
// -----------------------------------------------------------------------------
// Trilha append-only de concessão/revogação do papel administrativo.
//
// Importante:
// - admin é privilégio operacional, não tier financeiro;
// - a coleção interna nunca é lida/escrita diretamente pelo cliente;
// - o payload persistido não contém UID bruto; o vínculo usa somente prefixo
//   pseudonimizado do document id interno;
// - o usuário consulta somente a própria projeção sanitizada via callable;
// - IDs públicos/cursor não carregam o prefixo derivado do UID;
// - exclusão do documento do usuário não é tratada como revogação de admin;
// - retries do trigger são idempotentes pelo id determinístico do CloudEvent.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { FieldPath } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';

const PRIVILEGE_AUDIT_ACTION = 'admin_privilege_transition' as const;
const MAX_REVERSE_EPOCH = 9_999_999_999_999;
const PUBLIC_CURSOR_PATTERN = /^\d{13}_[a-f0-9]{24}$/;

type AdminPrivilegeEventType = 'admin_granted' | 'admin_revoked';

interface AdminPrivilegeAuditRecord {
  action: typeof PRIVILEGE_AUDIT_ACTION;
  eventType: AdminPrivilegeEventType;
  fromAdmin: boolean;
  toAdmin: boolean;
  source: 'user_role_transition';
  occurredAt: number;
  recordedAt: number;
}

interface GetPrivilegeHistoryRequest {
  cursor?: string | null;
  limit?: number | null;
}

function hashValue(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function normalizeEpoch(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), 50);
}

function isAdminRole(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'admin';
}

export function resolveAdminPrivilegeTransition(params: {
  beforeRole: unknown;
  afterRole: unknown;
}): AdminPrivilegeEventType | null {
  const beforeAdmin = isAdminRole(params.beforeRole);
  const afterAdmin = isAdminRole(params.afterRole);

  if (beforeAdmin === afterAdmin) return null;
  return afterAdmin ? 'admin_granted' : 'admin_revoked';
}

function buildPrivilegeAuditPrefix(uid: string): string {
  const normalizedUid = String(uid ?? '').trim();
  if (!normalizedUid) throw new Error('invalid-privilege-audit-uid');
  return `account_privilege_transition_${hashValue(normalizedUid, 20)}_`;
}

export function buildAdminPrivilegeAuditId(params: {
  uid: string;
  eventId: string;
  occurredAt: number;
}): string {
  const prefix = buildPrivilegeAuditPrefix(params.uid);
  const eventId = String(params.eventId ?? '').trim();
  if (!eventId) throw new Error('invalid-privilege-audit-event-id');

  const occurredAt = Math.min(
    normalizeEpoch(params.occurredAt),
    MAX_REVERSE_EPOCH
  );
  const reverseEpoch = String(MAX_REVERSE_EPOCH - occurredAt).padStart(13, '0');

  return `${prefix}${reverseEpoch}_${hashValue(eventId, 24)}`;
}

function buildPublicPrivilegeItemId(internalId: string): string {
  return `privilege_event_${hashValue(`privilege-history:${internalId}`, 24)}`;
}

function toPublicCursor(internalId: string, prefix: string): string {
  if (!internalId.startsWith(prefix)) {
    throw new Error('invalid-privilege-history-internal-cursor');
  }

  const suffix = internalId.slice(prefix.length);
  if (!PUBLIC_CURSOR_PATTERN.test(suffix)) {
    throw new Error('invalid-privilege-history-internal-cursor');
  }

  return suffix;
}

function normalizePublicCursor(value: unknown, prefix: string): string | null {
  const cursor = String(value ?? '').trim().slice(0, 64);
  if (!cursor) return null;
  if (!PUBLIC_CURSOR_PATTERN.test(cursor)) {
    throw new HttpsError('invalid-argument', 'Cursor de histórico inválido.');
  }
  return `${prefix}${cursor}`;
}

function parseEventTime(value: unknown): number {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export const auditUserPrivilegeChanges = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const uid = String(event.params.uid ?? '').trim();
    if (!uid) return;

    const beforeData = event.data?.before.exists
      ? event.data.before.data() as Record<string, unknown>
      : null;
    const afterData = event.data?.after.exists
      ? event.data.after.data() as Record<string, unknown>
      : null;

    // Exclusão de conta tem ciclo próprio de retenção. Não deve criar um novo
    // evento de privilégio nem reintroduzir identidade após o purge.
    if (!afterData) return;

    const eventType = resolveAdminPrivilegeTransition({
      beforeRole: beforeData?.['role'],
      afterRole: afterData['role'],
    });

    if (!eventType) return;

    const occurredAt = parseEventTime(event.time);
    const eventId = String(event.id ?? '').trim()
      || `${uid}:${occurredAt}:${eventType}`;
    const auditId = buildAdminPrivilegeAuditId({ uid, eventId, occurredAt });
    const auditRef = db.collection('account_privilege_audit').doc(auditId);
    const record: AdminPrivilegeAuditRecord = {
      action: PRIVILEGE_AUDIT_ACTION,
      eventType,
      fromAdmin: eventType === 'admin_revoked',
      toAdmin: eventType === 'admin_granted',
      source: 'user_role_transition',
      occurredAt,
      recordedAt: Date.now(),
    };

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const existing = await tx.get(auditRef);
      if (existing.exists) return;
      tx.create(auditRef, record);
    });
  }
);

export const getMyAccountPrivilegeHistory = onCall<GetPrivilegeHistoryRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const prefix = buildPrivilegeAuditPrefix(uid);
    const internalCursor = normalizePublicCursor(request.data?.cursor, prefix);
    const pageSize = normalizeLimit(request.data?.limit);
    const upperBound = `${prefix}\uf8ff`;

    let query = db
      .collection('account_privilege_audit')
      .orderBy(FieldPath.documentId(), 'asc');

    query = internalCursor
      ? query.startAfter(internalCursor)
      : query.startAt(prefix);

    const snapshot = await query
      .endBefore(upperBound)
      .limit(pageSize + 1)
      .get();

    const pageDocuments = snapshot.docs.slice(0, pageSize);
    const items = pageDocuments.flatMap((document) => {
      const data = document.data() as Partial<AdminPrivilegeAuditRecord>;
      if (data.action !== PRIVILEGE_AUDIT_ACTION) return [];
      if (data.eventType !== 'admin_granted' && data.eventType !== 'admin_revoked') {
        return [];
      }

      return [{
        id: buildPublicPrivilegeItemId(document.id),
        eventType: data.eventType,
        occurredAt: normalizeEpoch(data.occurredAt),
      }];
    });

    const hasMore = snapshot.size > pageSize;
    const lastDocumentId = pageDocuments[pageDocuments.length - 1]?.id ?? null;

    return {
      items,
      nextCursor: hasMore && lastDocumentId
        ? toPublicCursor(lastDocumentId, prefix)
        : null,
    };
  }
);
