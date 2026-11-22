// functions/src/community/community-invite-management.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY INVITE MANAGEMENT CONTRACTS
// -----------------------------------------------------------------------------

import { isNicknameIndexKey, normalizeNicknameForIndex } from '../public_index/nickname-key.policy';
import { normalizeCommunityId } from './community-preview.model';

export interface CommunityInviteManagementRequest {
  communityId?: unknown;
}

export interface CommunityInviteCandidateRequest
  extends CommunityInviteManagementRequest {
  nickname?: unknown;
}

export interface NormalizedCommunityInviteCandidateRequest {
  communityId: string;
  nicknameNormalized: string;
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
  items: CommunitySentInviteItem[];
  generatedAt: number;
}

export function normalizeCommunityInviteManagementRequest(
  raw: CommunityInviteManagementRequest | null | undefined
): string | null {
  return normalizeCommunityId(raw?.communityId);
}

export function normalizeCommunityInviteCandidateRequest(
  raw: CommunityInviteCandidateRequest | null | undefined
): NormalizedCommunityInviteCandidateRequest | null {
  const communityId = normalizeCommunityId(raw?.communityId);
  const nicknameNormalized = normalizeNicknameForIndex(
    String(raw?.nickname ?? '').slice(0, 80)
  );

  if (
    !communityId
    || !isNicknameIndexKey(nicknameNormalized)
  ) {
    return null;
  }

  return { communityId, nicknameNormalized };
}
