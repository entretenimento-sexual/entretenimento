// functions/src/community/community-invite.shared.ts
import { HttpsError } from 'firebase-functions/v2/https';

import { Timestamp } from '../firebaseApp';
import { normalizeCommunityMemberCount } from './community-member-count.policy';
import type { CommunityInviteStatus } from './community-invite.policy';
import type {
  CommunityMembershipRole,
  CommunityMembershipStatus,
} from './community-membership-request.policy';
import { normalizeCommunityId } from './community-preview.model';

export interface CommunityInviteDocument {
  type?: unknown;
  targetId?: unknown;
  communityId?: unknown;
  senderId?: unknown;
  receiverId?: unknown;
  status?: unknown;
  expiresAt?: unknown;
}

export interface CommunityInviteResult {
  inviteId: string;
  communityId: string;
  receiverId: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  deduplicated: boolean;
}

export const COMMUNITY_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const COMMUNITY_INVITE_POLICY_VERSION = 'community-invite-v1';

function stripControlCharacters(value: unknown): string {
  return [...String(value ?? '')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
}

export function normalizeCommunityInviteText(
  value: unknown,
  maxLength = 160
): string {
  return stripControlCharacters(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function requireCommunityInviteCanonicalPart(
  value: unknown,
  message: string
): string {
  const normalized = normalizeCommunityInviteText(value, 160);

  if (!normalized || normalized.includes(':') || normalized.includes('/')) {
    throw new HttpsError(
      'invalid-argument',
      message,
      { reason: 'invalid_invite_identity' }
    );
  }

  return normalized;
}

export function assertCommunityInviteAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = normalizeCommunityInviteText(auth?.uid, 160);

  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Usuário não autenticado.',
      { reason: 'authentication_required' }
    );
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

export function normalizeCommunityInviteMembershipStatus(
  value: unknown
): CommunityMembershipStatus | null {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

export function normalizeCommunityInviteMembershipRole(
  value: unknown
): CommunityMembershipRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

export function normalizeCommunityInviteStatus(
  value: unknown
): CommunityInviteStatus | null {
  return value === 'pending'
    || value === 'accepted'
    || value === 'declined'
    || value === 'revoked'
    || value === 'expired'
    ? value
    : null;
}

export function communityInviteToEpochMs(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof source.toMillis === 'function') {
      const millis = Number(source.toMillis());
      return Number.isFinite(millis) ? millis : null;
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
    }
  }

  return null;
}

/**
 * Alias do domínio de convites para a policy canônica de contagem comunitária.
 * `null` significa que a projeção atual não é confiável e não deve ser inventada.
 */
export function normalizeCommunityInviteMemberCount(
  rawCommunity: unknown
): number | null {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;

  return normalizeCommunityMemberCount(metrics['memberCount']);
}

export function isCommunityInviteOperational(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;

  return community['status'] === 'active'
    && moderation['state'] === 'active';
}

export function resolveCommunityMembersCanInvite(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const access = (community['access'] ?? {}) as Record<string, unknown>;
  const invites = (access['invites'] ?? {}) as Record<string, unknown>;
  return invites['membersCanInvite'] === true;
}

export function buildCommunityInviteId(
  communityId: string,
  receiverId: string
): string {
  return `community:${communityId}:to:${receiverId}`;
}

export function buildCommunityInviteNotificationId(
  communityId: string,
  receiverId: string
): string {
  return `community_invite_received_${communityId}_${receiverId}`;
}

export function requireCommunityInviteId(value: unknown): string {
  const inviteId = normalizeCommunityInviteText(value, 500);

  if (!/^community:[^:]{1,160}:to:[^:]{1,160}$/.test(inviteId)) {
    throw new HttpsError(
      'invalid-argument',
      'Convite de Comunidade inválido.',
      { reason: 'invalid_invite_id' }
    );
  }

  return inviteId;
}

export function resolveCommunityInviteCommunityId(
  invite: CommunityInviteDocument
): string {
  const communityId = normalizeCommunityId(
    invite.targetId ?? invite.communityId
  );

  if (!communityId) {
    throw new HttpsError(
      'failed-precondition',
      'Convite sem Comunidade válida.',
      { reason: 'invite_contract_invalid' }
    );
  }

  return communityId;
}
