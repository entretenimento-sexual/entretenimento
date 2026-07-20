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
  generatedAt: number;
}

export interface CommunityOwnershipTransferResponse {
  communityId: string;
  status: 'transferred';
  previousOwnerUid: string;
  newOwnerUid: string;
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
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
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

  return {
    items: source['items']
      .map(normalizeCandidate)
      .filter((item): item is CommunityOwnershipCandidate => item !== null),
    generatedAt: normalizeGeneratedAt(source['generatedAt']),
  };
}

export function normalizeCommunityOwnershipTransferResponse(
  raw: unknown
): CommunityOwnershipTransferResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const previousOwnerUid = normalizeSafeId(source['previousOwnerUid']);
  const newOwnerUid = normalizeSafeId(source['newOwnerUid']);

  if (
    !communityId
    || !previousOwnerUid
    || !newOwnerUid
    || source['status'] !== 'transferred'
  ) {
    return null;
  }

  return {
    communityId,
    status: 'transferred',
    previousOwnerUid,
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
