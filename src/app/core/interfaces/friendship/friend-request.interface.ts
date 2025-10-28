// src/app/core/interfaces/friendship/friend-request.interface.ts
export type FriendRequestStatus =
  | 'pending' | 'accepted' | 'declined' | 'expired' | 'canceled' | 'blocked';

export interface FriendRequest {
  id?: string;
  requesterUid: string;
  targetUid: string;
  message?: string;
  status: FriendRequestStatus;

  // 🔁 sempre epoch ms ou null
  createdAt: number | null;
  respondedAt?: number | null;
  acceptedAt?: number | null;
  updatedAt?: number | null;
  expiresAt?: number | null;
}
