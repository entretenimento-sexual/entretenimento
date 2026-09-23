// src/app/community/data-access/community-owner-succession-admin.model.ts
export type CommunityOwnerSuccessionTrigger =
  | 'owner_terminally_unavailable'
  | 'confirmed_abandonment';

export interface CommunityOwnerSuccessionAdminItem {
  communityId: string;
  communityName: string;
  communityStatus: string;
  previousOwnerUid: string;
  previousOwnerLabel: string;
  trigger: CommunityOwnerSuccessionTrigger;
  deadlineAt: number;
  activeRequestId: string | null;
  activeCandidateUid: string | null;
  activeCandidateLabel: string | null;
  activeRequestExpiresAt: number | null;
}

export interface CommunityOwnerSuccessionAdminQueue {
  items: readonly CommunityOwnerSuccessionAdminItem[];
  generatedAt: number;
}

function safeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized)
    ? normalized
    : null;
}

function text(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function epoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeItem(raw: unknown): CommunityOwnerSuccessionAdminItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = safeId(source['communityId']);
  const previousOwnerUid = safeId(source['previousOwnerUid']);
  const deadlineAt = epoch(source['deadlineAt']);
  const trigger = source['trigger'] === 'confirmed_abandonment'
    ? 'confirmed_abandonment'
    : source['trigger'] === 'owner_terminally_unavailable'
      ? 'owner_terminally_unavailable'
      : null;

  if (!communityId || !previousOwnerUid || !deadlineAt || !trigger) {
    return null;
  }

  return {
    communityId,
    communityName: text(source['communityName'], 80) || 'Comunidade',
    communityStatus: text(source['communityStatus'], 24) || 'unknown',
    previousOwnerUid,
    previousOwnerLabel:
      text(source['previousOwnerLabel'], 60) || 'Conta indisponível',
    trigger,
    deadlineAt,
    activeRequestId: source['activeRequestId'] == null
      ? null
      : safeId(source['activeRequestId']),
    activeCandidateUid: source['activeCandidateUid'] == null
      ? null
      : safeId(source['activeCandidateUid']),
    activeCandidateLabel: source['activeCandidateLabel'] == null
      ? null
      : text(source['activeCandidateLabel'], 60) || null,
    activeRequestExpiresAt: source['activeRequestExpiresAt'] == null
      ? null
      : epoch(source['activeRequestExpiresAt']),
  };
}

export function normalizeCommunityOwnerSuccessionAdminQueue(
  raw: unknown
): CommunityOwnerSuccessionAdminQueue | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(source['items'])) return null;

  return {
    items: source['items']
      .map(normalizeItem)
      .filter((item): item is CommunityOwnerSuccessionAdminItem => !!item),
    generatedAt: epoch(source['generatedAt']) ?? Date.now(),
  };
}
