//src\app\core\interfaces\friendship\friend-request.interface.ts
import { Timestamp } from 'firebase/firestore';
export interface FriendRequest {
  id?: string;
  requesterUid: string;
  targetUid: string;
  message?: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: Timestamp;
  respondedAt?: Timestamp;
  expiresAt?: Timestamp;
}
