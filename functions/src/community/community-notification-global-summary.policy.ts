// functions/src/community/community-notification-global-summary.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY NOTIFICATION GLOBAL SUMMARY
// -----------------------------------------------------------------------------
// Mantém a projeção O(1) observada pelo cliente:
// - totais globais de unread/priority;
// - quantidade de Comunidades com unread/prioridade;
// - pequena janela ordenada de Comunidades que precisam de atenção.
//
// O detalhe por Comunidade continua em /items e é consumido somente por páginas
// paginadas/visíveis. Nenhum algoritmo desta política varre todos os memberships.
// -----------------------------------------------------------------------------

export const COMMUNITY_NOTIFICATION_GLOBAL_SUMMARY_VERSION = 2;
export const COMMUNITY_NOTIFICATION_ATTENTION_WINDOW_SIZE = 8;
export const COMMUNITY_NOTIFICATION_ATTENTION_RANK_TIER = 1_000_000_000_000_000;
const MAX_ACTIVITY_COUNT = 1_000_000_000;

export interface CommunityNotificationSummaryItemProjection {
  readonly communityId: string;
  readonly unreadCount: number;
  readonly priorityUnreadCount: number;
  readonly hasPriorityUnread: boolean;
  readonly updatedAtMs: number;
  readonly attentionRank: number;
}

export interface CommunityNotificationSummaryChange {
  readonly before: CommunityNotificationSummaryItemProjection | null;
  readonly after: CommunityNotificationSummaryItemProjection | null;
}

export interface CommunityNotificationGlobalProjection {
  readonly projectionVersion: number;
  readonly requiresBackfill: boolean;
  readonly unreadCount: number;
  readonly priorityUnreadCount: number;
  readonly unreadCommunityCount: number;
  readonly priorityCommunityCount: number;
  readonly hasPriorityUnread: boolean;
  readonly attentionWindow: readonly CommunityNotificationSummaryItemProjection[];
  readonly updatedAtMs: number;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_ACTIVITY_COUNT);
}

function normalizeMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) && millis > 0 ? Math.trunc(millis) : 0;
  }

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof source.toMillis === 'function') {
      try {
        const millis = Number(source.toMillis());
        return Number.isFinite(millis) && millis > 0
          ? Math.trunc(millis)
          : 0;
      } catch {
        return 0;
      }
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const millis = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(millis) && millis > 0
        ? Math.trunc(millis)
        : 0;
    }
  }

  return 0;
}

export function buildCommunityNotificationAttentionRank(input: {
  readonly priorityUnreadCount: number;
  readonly updatedAtMs: number;
}): number {
  const tier = input.priorityUnreadCount > 0 ? 2 : 1;
  const updatedAtMs = Math.max(0, Math.trunc(input.updatedAtMs));
  return tier * COMMUNITY_NOTIFICATION_ATTENTION_RANK_TIER + updatedAtMs;
}

export function normalizeCommunityNotificationSummaryItem(
  communityIdValue: unknown,
  raw: unknown
): CommunityNotificationSummaryItemProjection | null {
  const communityId = String(communityIdValue ?? '').trim();
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const unreadCount = normalizeCount(source['unreadCount']);

  if (!communityId || unreadCount <= 0) return null;

  const priorityUnreadCount = Math.min(
    unreadCount,
    normalizeCount(source['priorityUnreadCount'])
  );
  const updatedAtMs =
    normalizeMillis(source['updatedAt'])
    || normalizeMillis(source['updatedAtMs']);
  const attentionRank = buildCommunityNotificationAttentionRank({
    priorityUnreadCount,
    updatedAtMs,
  });

  return {
    communityId,
    unreadCount,
    priorityUnreadCount,
    hasPriorityUnread: priorityUnreadCount > 0,
    updatedAtMs,
    attentionRank,
  };
}

export function buildCommunityNotificationSummaryItem(input: {
  readonly communityId: string;
  readonly unreadCount: number;
  readonly priorityUnreadCount: number;
  readonly updatedAtMs: number;
}): CommunityNotificationSummaryItemProjection | null {
  return normalizeCommunityNotificationSummaryItem(
    input.communityId,
    {
      unreadCount: input.unreadCount,
      priorityUnreadCount: input.priorityUnreadCount,
      updatedAtMs: input.updatedAtMs,
    }
  );
}

function normalizeGlobalCount(value: unknown): number {
  return normalizeCount(value);
}

function communityPresence(item: CommunityNotificationSummaryItemProjection | null): number {
  return item ? 1 : 0;
}

function priorityPresence(item: CommunityNotificationSummaryItemProjection | null): number {
  return item?.hasPriorityUnread ? 1 : 0;
}

export function buildCommunityNotificationAttentionWindow(input: {
  readonly candidates: readonly CommunityNotificationSummaryItemProjection[];
  readonly changes: readonly CommunityNotificationSummaryChange[];
}): readonly CommunityNotificationSummaryItemProjection[] {
  const byCommunityId = new Map(
    input.candidates.map((item) => [item.communityId, item] as const)
  );

  for (const change of input.changes) {
    const communityId =
      change.after?.communityId
      ?? change.before?.communityId
      ?? '';
    if (!communityId) continue;

    if (change.after) {
      byCommunityId.set(communityId, change.after);
    } else {
      byCommunityId.delete(communityId);
    }
  }

  return [...byCommunityId.values()]
    .sort((left, right) => {
      const rankDelta = right.attentionRank - left.attentionRank;
      if (rankDelta !== 0) return rankDelta;
      return left.communityId.localeCompare(right.communityId);
    })
    .slice(0, COMMUNITY_NOTIFICATION_ATTENTION_WINDOW_SIZE);
}

export function buildCommunityNotificationGlobalProjection(input: {
  readonly rawGlobal: unknown;
  readonly candidates: readonly CommunityNotificationSummaryItemProjection[];
  readonly changes: readonly CommunityNotificationSummaryChange[];
  readonly updatedAtMs: number;
}): CommunityNotificationGlobalProjection {
  const source = input.rawGlobal && typeof input.rawGlobal === 'object'
    && !Array.isArray(input.rawGlobal)
    ? input.rawGlobal as Record<string, unknown>
    : {};
  const currentVersion = Math.trunc(Number(source['projectionVersion']));
  const trusted = currentVersion === COMMUNITY_NOTIFICATION_GLOBAL_SUMMARY_VERSION;

  let unreadCount = normalizeGlobalCount(source['unreadCount']);
  let priorityUnreadCount = normalizeGlobalCount(source['priorityUnreadCount']);
  let unreadCommunityCount = normalizeGlobalCount(source['unreadCommunityCount']);
  let priorityCommunityCount = normalizeGlobalCount(source['priorityCommunityCount']);

  for (const change of input.changes) {
    unreadCount = Math.max(
      0,
      unreadCount
      - (change.before?.unreadCount ?? 0)
      + (change.after?.unreadCount ?? 0)
    );
    priorityUnreadCount = Math.max(
      0,
      Math.min(
        unreadCount,
        priorityUnreadCount
        - (change.before?.priorityUnreadCount ?? 0)
        + (change.after?.priorityUnreadCount ?? 0)
      )
    );
    unreadCommunityCount = Math.max(
      0,
      unreadCommunityCount
      - communityPresence(change.before)
      + communityPresence(change.after)
    );
    priorityCommunityCount = Math.max(
      0,
      priorityCommunityCount
      - priorityPresence(change.before)
      + priorityPresence(change.after)
    );
  }

  return {
    projectionVersion: trusted
      ? COMMUNITY_NOTIFICATION_GLOBAL_SUMMARY_VERSION
      : 1,
    requiresBackfill: !trusted,
    unreadCount,
    priorityUnreadCount,
    unreadCommunityCount,
    priorityCommunityCount,
    hasPriorityUnread: priorityUnreadCount > 0,
    attentionWindow: buildCommunityNotificationAttentionWindow({
      candidates: input.candidates,
      changes: input.changes,
    }),
    updatedAtMs: Math.max(0, Math.trunc(input.updatedAtMs)),
  };
}
