// src/app/core/services/data-handling/converters/friend-request.firestore-converter.ts
import {
  FirestoreDataConverter, Timestamp, DocumentData, QueryDocumentSnapshot, SnapshotOptions
} from 'firebase/firestore';
import { FriendRequest } from '../../../interfaces/friendship/friend-request.interface';

const toMillis = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  return null;
};
const toTs = (ms?: number | null) => ms != null ? Timestamp.fromMillis(ms) : null;

// 👇 note o Omit<FriendRequest, 'id'> e NÃO devolvemos id no fromFirestore
export const friendRequestConverter: FirestoreDataConverter<Omit<FriendRequest, 'id'>> = {
  fromFirestore(snap: QueryDocumentSnapshot, options: SnapshotOptions): Omit<FriendRequest, 'id'> {
    const d: any = snap.data(options);
    const ms = (x: any) => toMillis(x);
    return {
      requesterUid: d.requesterUid,
      targetUid: d.targetUid,
      message: d.message ?? null,
      status: d.status,
      createdAt: ms(d.createdAt),
      respondedAt: ms(d.respondedAt),
      acceptedAt: ms(d.acceptedAt),
      updatedAt: ms(d.updatedAt),
      expiresAt: ms(d.expiresAt),
    };
  },
  toFirestore(r: Omit<FriendRequest, 'id'>): DocumentData {
    return {
      requesterUid: r.requesterUid,
      targetUid: r.targetUid,
      message: r.message ?? null,
      status: r.status,
      createdAt: toTs(r.createdAt),
      respondedAt: toTs(r.respondedAt),
      acceptedAt: toTs(r.acceptedAt),
      updatedAt: toTs(r.updatedAt),
      expiresAt: toTs(r.expiresAt),
    };
  },
};
