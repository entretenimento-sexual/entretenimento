// src/app/community/data-access/community-invite.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY INVITE CLIENT CONTRACTS
// -----------------------------------------------------------------------------
// Somente contratos sanitizados devolvidos pelas Functions. Membership, papel,
// entitlement e autoridade de envio continuam sob controle do backend.
// -----------------------------------------------------------------------------

export interface CommunityInviteInboxItem {
  inviteId: string;
  communityId: string;
  communityName: string;
  senderId: string;
  senderLabel: string;
  senderAvatarUrl: string | null;
  sentAt: number;
  expiresAt: number;
}

export interface CommunityInviteInbox {
  items: readonly CommunityInviteInboxItem[];
  generatedAt: number;
}

export type CommunityInviteResultStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'revoked';

export interface CommunityInviteResult {
  inviteId: string;
  communityId: string;
  receiverId: string;
  status: CommunityInviteResultStatus;
  deduplicated: boolean;
}

export type CommunityInviteCandidateStatus =
  | 'eligible'
  | 'already_member'
  | 'invite_pending'
  | 'access_unavailable';

export interface CommunityInviteCandidate {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  status: CommunityInviteCandidateStatus;
}

export interface CommunityInviteCandidateResponse {
  candidate: CommunityInviteCandidate | null;
  generatedAt: number;
}

export interface CommunitySentInviteItem {
  inviteId: string;
  receiverId: string;
  receiverLabel: string;
  receiverAvatarUrl: string | null;
  senderId: string;
  senderLabel: string;
  sentAt: number;
  expiresAt: number;
}

export interface CommunitySentInvitesResponse {
  items: readonly CommunitySentInviteItem[];
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,500}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return [...String(value ?? '')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSafeId(value: unknown, maxLength = 160): string | null {
  const normalized = normalizeText(value, maxLength);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeInboxItem(raw: unknown): CommunityInviteInboxItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const inviteId = normalizeSafeId(source['inviteId'], 500);
  const communityId = normalizeSafeId(source['communityId']);
  const senderId = normalizeSafeId(source['senderId']);
  const communityName = normalizeText(source['communityName'], 80);
  const senderLabel = normalizeText(source['senderLabel'], 60);
  const sentAt = normalizeTimestamp(source['sentAt']);
  const expiresAt = normalizeTimestamp(source['expiresAt']);

  if (
    !inviteId
    || !inviteId.startsWith('community:')
    || !communityId
    || !senderId
    || !communityName
    || !senderLabel
    || !sentAt
    || !expiresAt
  ) {
    return null;
  }

  return {
    inviteId,
    communityId,
    communityName,
    senderId,
    senderLabel,
    senderAvatarUrl: normalizeHttpsUrl(source['senderAvatarUrl']),
    sentAt,
    expiresAt,
  };
}

function normalizeStatus(value: unknown): CommunityInviteResultStatus | null {
  return value === 'pending'
    || value === 'accepted'
    || value === 'declined'
    || value === 'revoked'
    ? value
    : null;
}

function normalizeCandidateStatus(
  value: unknown
): CommunityInviteCandidateStatus | null {
  return value === 'eligible'
    || value === 'already_member'
    || value === 'invite_pending'
    || value === 'access_unavailable'
    ? value
    : null;
}

function normalizeCandidate(raw: unknown): CommunityInviteCandidate | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const userId = normalizeSafeId(source['userId']);
  const nickname = normalizeText(source['nickname'], 60);
  const status = normalizeCandidateStatus(source['status']);

  if (!userId || !nickname || !status) return null;

  return {
    userId,
    nickname,
    avatarUrl: normalizeHttpsUrl(source['avatarUrl']),
    status,
  };
}

function normalizeSentInvite(raw: unknown): CommunitySentInviteItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const inviteId = normalizeSafeId(source['inviteId'], 500);
  const receiverId = normalizeSafeId(source['receiverId']);
  const receiverLabel = normalizeText(source['receiverLabel'], 60);
  const senderId = normalizeSafeId(source['senderId']);
  const senderLabel = normalizeText(source['senderLabel'], 60);
  const sentAt = normalizeTimestamp(source['sentAt']);
  const expiresAt = normalizeTimestamp(source['expiresAt']);

  if (
    !inviteId
    || !inviteId.startsWith('community:')
    || !receiverId
    || !receiverLabel
    || !senderId
    || !senderLabel
    || !sentAt
    || !expiresAt
  ) {
    return null;
  }

  return {
    inviteId,
    receiverId,
    receiverLabel,
    receiverAvatarUrl: normalizeHttpsUrl(source['receiverAvatarUrl']),
    senderId,
    senderLabel,
    sentAt,
    expiresAt,
  };
}

export function normalizeCommunityInviteInbox(
  raw: unknown
): CommunityInviteInbox | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(source['items'])) return null;

  const generatedAt = normalizeTimestamp(source['generatedAt']);
  if (!generatedAt) return null;

  return {
    items: source['items']
      .map((item) => normalizeInboxItem(item))
      .filter((item): item is CommunityInviteInboxItem => item !== null),
    generatedAt,
  };
}

export function normalizeCommunityInviteResult(
  raw: unknown
): CommunityInviteResult | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const inviteId = normalizeSafeId(source['inviteId'], 500);
  const communityId = normalizeSafeId(source['communityId']);
  const receiverId = normalizeSafeId(source['receiverId']);
  const status = normalizeStatus(source['status']);

  if (!inviteId || !communityId || !receiverId || !status) return null;

  return {
    inviteId,
    communityId,
    receiverId,
    status,
    deduplicated: source['deduplicated'] === true,
  };
}

export function normalizeCommunityInviteCandidateResponse(
  raw: unknown
): CommunityInviteCandidateResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = normalizeTimestamp(source['generatedAt']);
  if (!generatedAt) return null;

  if (source['candidate'] === null) {
    return { candidate: null, generatedAt };
  }

  const candidate = normalizeCandidate(source['candidate']);
  return candidate ? { candidate, generatedAt } : null;
}

export function normalizeCommunitySentInvitesResponse(
  raw: unknown
): CommunitySentInvitesResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = normalizeTimestamp(source['generatedAt']);
  if (!generatedAt || !Array.isArray(source['items'])) return null;

  return {
    items: source['items']
      .map((item) => normalizeSentInvite(item))
      .filter((item): item is CommunitySentInviteItem => item !== null),
    generatedAt,
  };
}
