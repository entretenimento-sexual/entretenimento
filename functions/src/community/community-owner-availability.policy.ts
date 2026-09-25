// functions/src/community/community-owner-availability.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNER AVAILABILITY
// -----------------------------------------------------------------------------
// Suspensão/restrição da conta proprietária não transfere ownership
// automaticamente. Em vez disso, a Comunidade entra em pausa reversível,
// preservando o status anterior para restauração segura quando a conta volta a
// ficar ativa.
// -----------------------------------------------------------------------------

export type OwnerAccountLifecycleStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted'
  | null;

export type OwnerAvailabilityCommunityStatus =
  | 'active'
  | 'paused'
  | 'dormant'
  | 'archived'
  | 'scheduled_for_deletion'
  | null;

export interface CommunityOwnerAvailabilityHold {
  readonly state: 'owner_unavailable';
  readonly ownerUid: string;
  readonly accountStatus: Exclude<OwnerAccountLifecycleStatus, 'active' | null>;
  readonly previousStatus: 'active' | 'paused' | 'dormant';
  readonly startedAt: number;
  readonly policyVersion: 1;
}

export type CommunityOwnerAvailabilityDecision =
  | Readonly<{ kind: 'none' }>
  | Readonly<{
      kind: 'apply';
      nextStatus: 'paused';
      hold: CommunityOwnerAvailabilityHold;
    }>
  | Readonly<{
      kind: 'clear';
      nextStatus: 'active' | 'paused' | 'dormant';
    }>;

function normalizeLifecycleStatus(value: unknown): OwnerAccountLifecycleStatus {
  return value === 'active'
    || value === 'self_suspended'
    || value === 'moderation_suspended'
    || value === 'pending_deletion'
    || value === 'deleted'
    ? value
    : null;
}

function normalizeCommunityStatus(value: unknown): OwnerAvailabilityCommunityStatus {
  return value === 'active'
    || value === 'paused'
    || value === 'dormant'
    || value === 'archived'
    || value === 'scheduled_for_deletion'
    ? value
    : null;
}

function normalizeHold(
  raw: unknown
): CommunityOwnerAvailabilityHold | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const value = raw as Record<string, unknown>;
  const accountStatus = normalizeLifecycleStatus(value['accountStatus']);
  const previousStatus = normalizeCommunityStatus(value['previousStatus']);
  const ownerUid = String(value['ownerUid'] ?? '').trim();
  const startedAt = Number(value['startedAt']);

  if (
    value['state'] !== 'owner_unavailable'
    || accountStatus === null
    || accountStatus === 'active'
    || (
      previousStatus !== 'active'
      && previousStatus !== 'paused'
      && previousStatus !== 'dormant'
    )
    || !ownerUid
    || !Number.isFinite(startedAt)
    || startedAt <= 0
  ) {
    return null;
  }

  return {
    state: 'owner_unavailable',
    ownerUid,
    accountStatus,
    previousStatus,
    startedAt: Math.trunc(startedAt),
    policyVersion: 1,
  };
}

export function evaluateCommunityOwnerAvailability(input: {
  ownerUid: string;
  accountStatus: unknown;
  communityStatus: unknown;
  rawHold: unknown;
  now: number;
}): CommunityOwnerAvailabilityDecision {
  const ownerUid = String(input.ownerUid ?? '').trim();
  const accountStatus = normalizeLifecycleStatus(input.accountStatus);
  const communityStatus = normalizeCommunityStatus(input.communityStatus);
  const existingHold = normalizeHold(input.rawHold);

  if (!ownerUid || !Number.isFinite(input.now) || input.now <= 0) {
    return { kind: 'none' };
  }

  if (accountStatus === 'active') {
    if (!existingHold || existingHold.ownerUid !== ownerUid) {
      return { kind: 'none' };
    }

    if (
      communityStatus !== 'paused'
      && communityStatus !== existingHold.previousStatus
    ) {
      // Outra transição válida venceu a corrida. Removemos apenas o hold sem
      // tentar reescrever um status que já mudou por outro fluxo.
      return {
        kind: 'clear',
        nextStatus:
          communityStatus === 'active'
          || communityStatus === 'paused'
          || communityStatus === 'dormant'
            ? communityStatus
            : existingHold.previousStatus,
      };
    }

    return {
      kind: 'clear',
      nextStatus: existingHold.previousStatus,
    };
  }

  if (
    accountStatus !== 'self_suspended'
    && accountStatus !== 'moderation_suspended'
    && accountStatus !== 'pending_deletion'
    && accountStatus !== 'deleted'
  ) {
    return { kind: 'none' };
  }

  if (
    communityStatus !== 'active'
    && communityStatus !== 'paused'
    && communityStatus !== 'dormant'
  ) {
    return { kind: 'none' };
  }

  if (existingHold?.ownerUid === ownerUid) {
    return {
      kind: 'apply',
      nextStatus: 'paused',
      hold: {
        ...existingHold,
        accountStatus,
      },
    };
  }

  return {
    kind: 'apply',
    nextStatus: 'paused',
    hold: {
      state: 'owner_unavailable',
      ownerUid,
      accountStatus,
      previousStatus: communityStatus,
      startedAt: Math.trunc(input.now),
      policyVersion: 1,
    },
  };
}
