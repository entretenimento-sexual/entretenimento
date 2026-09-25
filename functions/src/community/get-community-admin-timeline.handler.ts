// functions/src/community/get-community-admin-timeline.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY ADMIN TIMELINE
// -----------------------------------------------------------------------------
// Owner/admin recebem somente DTO sanitizado. UIDs, audit bruto, reason,
// evidências e IDs de conteúdo não saem do backend.
// -----------------------------------------------------------------------------

import { Buffer } from 'node:buffer';

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import type {
  CommunityAdminTimelineCategory,
  CommunityAdminTimelineDetails,
  CommunityAdminTimelineEventType,
} from './community-admin-timeline.projection';
import { normalizeCommunityId } from './community-preview.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

interface CommunityAdminTimelineRequest {
  communityId?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

interface CommunityAdminTimelineIdentity {
  kind: 'user' | 'system';
  label: string;
}

interface CommunityAdminTimelineItem {
  id: string;
  category: CommunityAdminTimelineCategory;
  eventType: CommunityAdminTimelineEventType;
  actor: CommunityAdminTimelineIdentity;
  subject: CommunityAdminTimelineIdentity | null;
  details: CommunityAdminTimelineDetails;
  createdAt: number;
}

interface CommunityAdminTimelineResponse {
  items: CommunityAdminTimelineItem[];
  nextCursor: string | null;
  generatedAt: number;
}

interface TimelineCursor {
  createdAtMs: number;
  documentId: string;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 40;
const EVENT_TYPES = new Set<CommunityAdminTimelineEventType>([
  'member_role_changed',
  'member_blocked',
  'member_unblocked',
  'member_removed',
  'membership_approved',
  'membership_rejected',
  'ownership_transferred',
  'community_archived',
  'settings_changed',
  'content_removed',
  'topic_moderated',
  'official_status_changed',
  'lifecycle_changed',
]);
const CATEGORIES = new Set<CommunityAdminTimelineCategory>([
  'membership',
  'ownership',
  'settings',
  'moderation',
  'official',
  'lifecycle',
]);

function authenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();

  if (!SAFE_ID_PATTERN.test(uid)) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.',
      { reason: 'email_verification_required' }
    );
  }

  return uid;
}

function limitValue(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function text(value: unknown, maxLength = 60): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional.
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function encodeCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: unknown): TimelineCursor | null {
  const token = String(value ?? '').trim();
  if (!token) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    const createdAtMs = Math.trunc(Number(decoded['createdAtMs']));
    const documentId = String(decoded['documentId'] ?? '').trim();

    return Number.isFinite(createdAtMs)
      && createdAtMs > 0
      && documentId.length > 0
      && documentId.length <= 256
      ? { createdAtMs, documentId }
      : null;
  } catch {
    return null;
  }
}

function safeDetails(value: unknown): CommunityAdminTimelineDetails {
  const raw = (value ?? {}) as Record<string, unknown>;
  const details: CommunityAdminTimelineDetails = {};
  const roles = new Set(['owner', 'admin', 'moderator', 'member']);

  if (raw['previousRole'] === null || roles.has(String(raw['previousRole']))) {
    details.previousRole =
      raw['previousRole'] as CommunityAdminTimelineDetails['previousRole'];
  }

  if (raw['nextRole'] === null || roles.has(String(raw['nextRole']))) {
    details.nextRole =
      raw['nextRole'] as CommunityAdminTimelineDetails['nextRole'];
  }

  if (Array.isArray(raw['changedFields'])) {
    details.changedFields = raw['changedFields']
      .map((item) => text(item, 40))
      .filter(Boolean)
      .slice(0, 8);
  }

  if (
    raw['target'] === 'post'
    || raw['target'] === 'comment'
    || raw['target'] === 'reply'
    || raw['target'] === 'topic'
  ) {
    details.target = raw['target'];
  }

  if (
    raw['action'] === 'locked'
    || raw['action'] === 'unlocked'
    || raw['action'] === 'removed'
  ) {
    details.action = raw['action'];
  }

  const previousStatus = text(raw['previousStatus'], 48).toLowerCase();
  const nextStatus = text(raw['nextStatus'], 48).toLowerCase();

  if (/^[a-z0-9_-]{1,48}$/.test(previousStatus)) {
    details.previousStatus = previousStatus;
  }

  if (/^[a-z0-9_-]{1,48}$/.test(nextStatus)) {
    details.nextStatus = nextStatus;
  }

  return details;
}

async function labelsFor(uids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(uids.filter((uid) => SAFE_ID_PATTERN.test(uid)))];
  if (unique.length === 0) return new Map();

  const snapshots = await db.getAll(
    ...unique.map((uid) => db.collection('public_profiles').doc(uid))
  );

  return new Map(
    snapshots.map((snapshot) => {
      const profile = snapshot.exists ? snapshot.data() ?? {} : {};
      const label =
        text(profile['nickname'])
        || text(profile['displayName'])
        || 'Conta indisponível';

      return [snapshot.id, label] as const;
    })
  );
}

export const getCommunityAdminTimeline = onCall<CommunityAdminTimelineRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityAdminTimelineResponse> => {
    assertCommunityCallableAppCheck(request.app);

    const actorUid = authenticatedUid(request.auth);
    const communityId = normalizeCommunityId(request.data?.communityId);
    const providedCursor = String(request.data?.cursor ?? '').trim();
    const cursor = providedCursor ? decodeCursor(providedCursor) : null;
    const limit = limitValue(request.data?.limit);

    if (!communityId || (providedCursor && !cursor)) {
      throw new HttpsError(
        'invalid-argument',
        'Consulta do histórico administrativo inválida.',
        { reason: 'invalid_community_admin_timeline_query' }
      );
    }

    const context = await getCommunityViewerContext(actorUid, communityId);

    if (
      context.community.source.type !== 'community'
      || !context.activeMembership
      || (context.viewerRole !== 'owner' && context.viewerRole !== 'admin')
    ) {
      throw new HttpsError(
        'permission-denied',
        'Somente proprietário e Administração podem consultar este histórico.',
        { reason: 'community_admin_timeline_forbidden' }
      );
    }

    let query = db
      .collection('community_admin_timeline')
      .doc(communityId)
      .collection('items')
      .orderBy('createdAtMs', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(limit + 1);

    if (cursor) {
      query = query.startAfter(cursor.createdAtMs, cursor.documentId);
    }

    const snapshot = await query.get();
    const pageDocuments = snapshot.docs.slice(0, limit);
    const safeItems = pageDocuments
      .map((document) => {
        const raw = document.data() ?? {};
        const category = raw['category'] as CommunityAdminTimelineCategory;
        const eventType = raw['eventType'] as CommunityAdminTimelineEventType;
        const createdAt = Math.trunc(Number(raw['createdAtMs']));
        const actorKind = raw['actorKind'] === 'system' ? 'system' : 'user';
        const actorUidValue = String(raw['actorUid'] ?? '').trim();
        const subjectUidValue = String(raw['subjectUid'] ?? '').trim();

        if (
          !CATEGORIES.has(category)
          || !EVENT_TYPES.has(eventType)
          || !Number.isFinite(createdAt)
          || createdAt <= 0
        ) {
          return null;
        }

        const safeActorUid =
          actorKind === 'user' && SAFE_ID_PATTERN.test(actorUidValue)
            ? actorUidValue
            : null;
        const safeSubjectUid = SAFE_ID_PATTERN.test(subjectUidValue)
          ? subjectUidValue
          : null;

        if (actorKind === 'user' && !safeActorUid) return null;

        return {
          id: document.id,
          category,
          eventType,
          actorKind,
          actorUid: safeActorUid,
          subjectUid: safeSubjectUid,
          details: safeDetails(raw['details']),
          createdAt,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const labels = await labelsFor(
      safeItems.flatMap((item) => [
        ...(item.actorUid ? [item.actorUid] : []),
        ...(item.subjectUid ? [item.subjectUid] : []),
      ])
    );

    const items: CommunityAdminTimelineItem[] = safeItems.map((item) => ({
      id: item.id,
      category: item.category,
      eventType: item.eventType,
      actor: item.actorKind === 'system'
        ? { kind: 'system', label: 'Sistema' }
        : {
          kind: 'user',
          label: labels.get(item.actorUid ?? '') ?? 'Conta indisponível',
        },
      subject: item.subjectUid
        ? {
          kind: 'user',
          label: labels.get(item.subjectUid) ?? 'Conta indisponível',
        }
        : null,
      details: item.details,
      createdAt: item.createdAt,
    }));

    const hasMore = snapshot.docs.length > limit;
    const lastDocument = pageDocuments.at(-1) ?? null;
    const lastCreatedAt = Math.trunc(
      Number(lastDocument?.data()?.['createdAtMs'])
    );

    return {
      items,
      nextCursor:
        hasMore && lastDocument && Number.isFinite(lastCreatedAt)
          ? encodeCursor({
            createdAtMs: lastCreatedAt,
            documentId: lastDocument.id,
          })
          : null,
      generatedAt: Date.now(),
    };
  }
);
