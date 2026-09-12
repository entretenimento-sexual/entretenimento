// functions/src/community/community-notification-membership.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY NOTIFICATION MEMBERSHIP POLICY
// -----------------------------------------------------------------------------
// Deriva o ciclo social atual somente de marcadores canônicos do membership.
// `joinedAt` muda em novas entradas/aprovações/aceites e `unblockedAt` muda ao
// desbloquear. Nenhum valor copiado para a notificação se torna autoridade.
// -----------------------------------------------------------------------------

function normalizeTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof source.toMillis === 'function') {
      const time = Number(source.toMillis());
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const time = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }
  }

  return null;
}

export function resolveCommunityNotificationMembershipCycleStartedAtMs(
  raw: unknown
): number | null {
  const membership = (raw ?? {}) as Record<string, unknown>;
  if (membership['status'] !== 'active') return null;

  const joinedAt = normalizeTimestampMs(membership['joinedAt']);
  const unblockedAt = normalizeTimestampMs(membership['unblockedAt']);
  const cycleStartedAtMs = Math.max(joinedAt ?? 0, unblockedAt ?? 0);

  return cycleStartedAtMs > 0 ? cycleStartedAtMs : null;
}

export function isCommunityNotificationMembershipCycleCurrent(
  membership: unknown,
  rawCycleStartedAtMs: unknown
): boolean {
  const currentCycleStartedAtMs =
    resolveCommunityNotificationMembershipCycleStartedAtMs(membership);
  const notificationCycleStartedAtMs = normalizeTimestampMs(rawCycleStartedAtMs);

  return currentCycleStartedAtMs !== null
    && notificationCycleStartedAtMs === currentCycleStartedAtMs;
}

export function shouldReconcileCommunityNotificationMembership(
  before: unknown,
  after: unknown
): boolean {
  const beforeMembership = (before ?? {}) as Record<string, unknown>;
  const afterMembership = (after ?? {}) as Record<string, unknown>;
  const beforeActive = beforeMembership['status'] === 'active';
  const afterActive = afterMembership['status'] === 'active';

  if (beforeActive !== afterActive) return true;
  if (!afterActive) return false;

  return resolveCommunityNotificationMembershipCycleStartedAtMs(before)
    !== resolveCommunityNotificationMembershipCycleStartedAtMs(after);
}
