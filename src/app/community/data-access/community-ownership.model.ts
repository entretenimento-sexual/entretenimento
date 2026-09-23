// src/app/community/data-access/community-ownership.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNERSHIP CLIENT CONTRACTS
// -----------------------------------------------------------------------------
// Toda resposta do backend é normalizada antes de alcançar a UI.
// -----------------------------------------------------------------------------

export type CommunityOwnershipCandidateRole = 'admin' | 'moderator' | 'member';

export interface CommunityOwnershipCandidate {
  uid: string;
  label: string;
  avatarUrl: string | null;
  role: CommunityOwnershipCandidateRole;
}

export interface CommunityOwnershipCandidatesResponse {
  items: readonly CommunityOwnershipCandidate[];
  nextCursor: string | null;
  generatedAt: number;
}

export type CommunityOwnershipTransferMode =
  | 'voluntary'
  | 'terminal_succession';

export interface CommunityOwnershipTransferResponse {
  requestId: string;
  communityId: string;
  candidateUid: string;
  status: 'pending';
  mode: CommunityOwnershipTransferMode;
  expiresAt: number;
  generatedAt: number;
}

export interface CommunityOwnershipInboxItem {
  requestId: string;
  communityId: string;
  communityName: string;
  previousOwnerUid: string;
  previousOwnerLabel: string;
  candidateUid: string;
  candidateLabel: string;
  mode: CommunityOwnershipTransferMode;
  status: string;
  expiresAt: number;
  createdAt: number;
}

export interface CommunityOwnershipInboxResponse {
  incoming: readonly CommunityOwnershipInboxItem[];
  outgoing: readonly CommunityOwnershipInboxItem[];
  generatedAt: number;
}

export interface CommunityOwnershipTransferActionResponse {
  requestId: string;
  communityId: string;
  status: 'declined' | 'expired' | 'completed' | 'canceled';
  newOwnerUid: string | null;
  generatedAt: number;
}

export interface CommunityArchiveResponse {
  communityId: string;
  status: 'archived';
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeGeneratedAt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : Date.now();
}

function normalizeTransferMode(
  value: unknown
): CommunityOwnershipTransferMode | null {
  return value === 'voluntary' || value === 'terminal_succession'
    ? value
    : null;
}

function normalizeCandidateRole(
  value: unknown
): CommunityOwnershipCandidateRole | null {
  return value === 'admin' || value === 'moderator' || value === 'member'
    ? value
    : null;
}

function normalizeCandidate(raw: unknown): CommunityOwnershipCandidate | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const uid = normalizeSafeId(source['uid']);
  const label = normalizeText(source['label'], 60);
  const role = normalizeCandidateRole(source['role']);

  if (!uid || !label || !role) return null;

  return {
    uid,
    label,
    avatarUrl: normalizeHttpsUrl(source['avatarUrl']),
    role,
  };
}

export function normalizeCommunityOwnershipCandidatesResponse(
  raw: unknown
): CommunityOwnershipCandidatesResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;

  if (!Array.isArray(source['items'])) return null;

  const rawNextCursor = source['nextCursor'];
  const nextCursor = rawNextCursor === null || rawNextCursor === undefined
    ? null
    : normalizeSafeId(rawNextCursor);

  if (rawNextCursor !== null && rawNextCursor !== undefined && !nextCursor) {
    return null;
  }

  return {
    items: source['items']
      .map(normalizeCandidate)
      .filter((item): item is CommunityOwnershipCandidate => item !== null),
    nextCursor,
    generatedAt: normalizeGeneratedAt(source['generatedAt']),
  };
}

export function normalizeCommunityOwnershipTransferResponse(
  raw: unknown
): CommunityOwnershipTransferResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const requestId = normalizeSafeId(source['requestId']);
  const communityId = normalizeSafeId(source['communityId']);
  const candidateUid = normalizeSafeId(source['candidateUid']);
  const mode = normalizeTransferMode(source['mode']);
  const expiresAt = Number(source['expiresAt']);

  if (
    !requestId
    || !communityId
    || !candidateUid
    || !mode
    || source['status'] !== 'pending'
    || !Number.isFinite(expiresAt)
    || expiresAt <= 0
  ) {
    return null;
  }

  return {
    requestId,
    communityId,
    candidateUid,
    status: 'pending',
    mode,
    expiresAt: Math.trunc(expiresAt),
    generatedAt: normalizeGeneratedAt(source['generatedAt']),
  };
}

function normalizeOwnershipInboxItem(
  raw: unknown
): CommunityOwnershipInboxItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const requestId = normalizeSafeId(source['requestId']);
  const communityId = normalizeSafeId(source['communityId']);
  const previousOwnerUid = normalizeSafeId(source['previousOwnerUid']);
  const candidateUid = normalizeSafeId(source['candidateUid']);
  const mode = normalizeTransferMode(source['mode']);
  const communityName = normalizeText(source['communityName'], 80);
  const previousOwnerLabel = normalizeText(source['previousOwnerLabel'], 60);
  const candidateLabel = normalizeText(source['candidateLabel'], 60);
  const status = normalizeText(source['status'], 32);
  const expiresAt = Number(source['expiresAt']);
  const createdAt = Number(source['createdAt']);

  if (
    !requestId
    || !communityId
    || !previousOwnerUid
    || !candidateUid
    || !mode
    || !communityName
    || !previousOwnerLabel
    || !candidateLabel
    || !status
    || !Number.isFinite(expiresAt)
    || expiresAt <= 0
    || !Number.isFinite(createdAt)
    || createdAt <= 0
  ) {
    return null;
  }

  return {
    requestId,
    communityId,
    communityName,
    previousOwnerUid,
    previousOwnerLabel,
    candidateUid,
    candidateLabel,
    mode,
    status,
    expiresAt: Math.trunc(expiresAt),
    createdAt: Math.trunc(createdAt),
  };
}

export function normalizeCommunityOwnershipInboxResponse(
  raw: unknown
): CommunityOwnershipInboxResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(source['incoming']) || !Array.isArray(source['outgoing'])) {
    return null;
  }

  return {
    incoming: source['incoming']
      .map(normalizeOwnershipInboxItem)
      .filter((item): item is CommunityOwnershipInboxItem => !!item),
    outgoing: source['outgoing']
      .map(normalizeOwnershipInboxItem)
      .filter((item): item is CommunityOwnershipInboxItem => !!item),
    generatedAt: normalizeGeneratedAt(source['generatedAt']),
  };
}

export function normalizeCommunityOwnershipTransferActionResponse(
  raw: unknown
): CommunityOwnershipTransferActionResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const requestId = normalizeSafeId(source['requestId']);
  const communityId = normalizeSafeId(source['communityId']);
  const status = source['status'];
  const newOwnerUid = source['newOwnerUid'] === null
    || source['newOwnerUid'] === undefined
      ? null
      : normalizeSafeId(source['newOwnerUid']);

  if (
    !requestId
    || !communityId
    || (
      status !== 'declined'
      && status !== 'expired'
      && status !== 'completed'
      && status !== 'canceled'
    )
    || (
      source['newOwnerUid'] !== null
      && source['newOwnerUid'] !== undefined
      && !newOwnerUid
    )
  ) {
    return null;
  }

  return {
    requestId,
    communityId,
    status,
    newOwnerUid,
    generatedAt: normalizeGeneratedAt(source['generatedAt']),
  };
}

export function normalizeCommunityArchiveResponse(
  raw: unknown
): CommunityArchiveResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);

  if (!communityId || source['status'] !== 'archived') return null;

  return {
    communityId,
    status: 'archived',
    generatedAt: normalizeGeneratedAt(source['generatedAt']),
  };
}
