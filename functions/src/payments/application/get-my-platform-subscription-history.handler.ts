// functions/src/payments/application/get-my-platform-subscription-history.handler.ts
// -----------------------------------------------------------------------------
// GET MY PLATFORM SUBSCRIPTION HISTORY
// -----------------------------------------------------------------------------
// Projeção sanitizada e somente leitura da trilha interna de assinatura.
//
// Segurança:
// - exige usuário autenticado;
// - não expõe billing_audit diretamente;
// - não devolve provider payload, IDs de transação, checkout ou entitlement;
// - item.id é um identificador público derivado e não o document id interno;
// - o cursor público contém apenas o sufixo de ordenação, sem prefixo/hash do UID;
// - o cliente não possui qualquer rota de escrita sobre o histórico.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import type { PlatformPlanKey, PlatformRole } from '../domain/billing.model';
import {
  buildPlatformSubscriptionAuditPrefix,
  PLATFORM_SUBSCRIPTION_TRANSITION_ACTION,
  PlatformSubscriptionTransitionEventType,
  PlatformSubscriptionTransitionSource,
} from './platform-subscription-audit.service';

interface GetHistoryRequest {
  cursor?: string | null;
  limit?: number | null;
}

interface SanitizedSubscriptionSnapshot {
  active: boolean;
  role: PlatformRole | 'free';
  planKey: PlatformPlanKey | null;
  startsAt: number | null;
  endsAt: number | null;
}

interface SanitizedSubscriptionHistoryItem {
  id: string;
  eventType: PlatformSubscriptionTransitionEventType;
  from: SanitizedSubscriptionSnapshot | null;
  to: SanitizedSubscriptionSnapshot | null;
  source: PlatformSubscriptionTransitionSource;
  reason: string;
  occurredAt: number;
}

const EVENT_TYPES = new Set<PlatformSubscriptionTransitionEventType>([
  'subscription_started',
  'subscription_renewed',
  'subscription_upgraded',
  'subscription_downgraded',
  'subscription_expired',
  'subscription_deactivated',
  'subscription_repaired',
]);

const SOURCES = new Set<PlatformSubscriptionTransitionSource>([
  'payment_settlement',
  'subscription_reconciliation',
  'system_repair',
  'entitlement_change',
  'entitlement_deleted',
]);

const PUBLIC_CURSOR_PATTERN = /^\d{13}_[a-f0-9]{24}$/;

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), 50);
}

function finiteEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function isPlatformRole(value: unknown): value is PlatformRole {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

function isPlatformPlanKey(value: unknown): value is PlatformPlanKey {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

function sanitizeSnapshot(value: unknown): SanitizedSubscriptionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const active = record['active'] === true;

  return {
    active,
    role: active && isPlatformRole(record['role']) ? record['role'] : 'free',
    planKey: isPlatformPlanKey(record['planKey']) ? record['planKey'] : null,
    startsAt: finiteEpoch(record['startsAt']),
    endsAt: finiteEpoch(record['endsAt']),
  };
}

function buildPublicHistoryItemId(internalDocumentId: string): string {
  const digest = createHash('sha256')
    .update(`subscription-history:${internalDocumentId}`)
    .digest('hex')
    .slice(0, 24);

  return `subscription_event_${digest}`;
}

export function sanitizePlatformSubscriptionHistoryItem(
  publicId: string,
  value: unknown
): SanitizedSubscriptionHistoryItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  if (record['action'] !== PLATFORM_SUBSCRIPTION_TRANSITION_ACTION) return null;
  if (!EVENT_TYPES.has(record['eventType'] as PlatformSubscriptionTransitionEventType)) {
    return null;
  }
  if (!SOURCES.has(record['source'] as PlatformSubscriptionTransitionSource)) {
    return null;
  }

  const occurredAt = finiteEpoch(record['occurredAt']);
  if (occurredAt === null) return null;

  return {
    id: publicId,
    eventType: record['eventType'] as PlatformSubscriptionTransitionEventType,
    from: sanitizeSnapshot(record['from']),
    to: sanitizeSnapshot(record['to']),
    source: record['source'] as PlatformSubscriptionTransitionSource,
    reason: normalizeText(record['reason'], 120) || 'subscription_state_changed',
    occurredAt,
  };
}

export function toPublicSubscriptionHistoryCursor(
  internalDocumentId: string,
  prefix: string
): string {
  if (!internalDocumentId.startsWith(prefix)) {
    throw new Error('invalid-subscription-history-internal-cursor');
  }

  const suffix = internalDocumentId.slice(prefix.length);
  if (!PUBLIC_CURSOR_PATTERN.test(suffix)) {
    throw new Error('invalid-subscription-history-internal-cursor');
  }

  return suffix;
}

function normalizeCursor(value: unknown, prefix: string): string | null {
  const publicCursor = normalizeText(value, 64);
  if (!publicCursor) return null;
  if (!PUBLIC_CURSOR_PATTERN.test(publicCursor)) {
    throw new HttpsError('invalid-argument', 'Cursor de histórico inválido.');
  }
  return `${prefix}${publicCursor}`;
}

export const getMyPlatformSubscriptionHistory = onCall<GetHistoryRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const prefix = buildPlatformSubscriptionAuditPrefix(uid);
    const cursor = normalizeCursor(request.data?.cursor, prefix);
    const pageSize = normalizeLimit(request.data?.limit);
    const upperBound = `${prefix}\uf8ff`;

    let query = db
      .collection('billing_audit')
      .orderBy(FieldPath.documentId(), 'asc');

    query = cursor
      ? query.startAfter(cursor)
      : query.startAt(prefix);

    const snapshot = await query
      .endBefore(upperBound)
      .limit(pageSize + 1)
      .get();

    const pageDocuments = snapshot.docs.slice(0, pageSize);
    const items = pageDocuments
      .map((document) =>
        sanitizePlatformSubscriptionHistoryItem(
          buildPublicHistoryItemId(document.id),
          document.data()
        )
      )
      .filter((item): item is SanitizedSubscriptionHistoryItem => item !== null);
    const hasMore = snapshot.size > pageSize;
    const lastDocumentId = pageDocuments[pageDocuments.length - 1]?.id ?? null;
    const nextCursor = hasMore && lastDocumentId
      ? toPublicSubscriptionHistoryCursor(lastDocumentId, prefix)
      : null;

    return {
      items,
      nextCursor,
    };
  }
);
