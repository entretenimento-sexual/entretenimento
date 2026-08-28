// src/app/core/services/data-handling/converters/friend-request.firestore-converter.ts
// Conversor Firestore para FriendRequest
// - Centraliza conversão de datas usando epoch-utils (padrão único no app)
// - Mantém a Store/Model em epoch (number | null), e Firestore em Timestamp
// - NÃO retorna `id` no fromFirestore (id vem do snap.id e deve ser anexado no repositório/service)

import {
  FirestoreDataConverter,
  DocumentData,
  QueryDocumentSnapshot,
  SnapshotOptions,
} from 'firebase/firestore';

import { FriendRequest } from '../../../interfaces/friendship/friend-request.interface';
import { toEpoch, toTimestamp } from 'src/app/core/utils/epoch-utils';


// 👇 note o Omit<FriendRequest, 'id'> e NÃO devolvemos id no fromFirestore
export const friendRequestConverter: FirestoreDataConverter<Omit<FriendRequest, 'id'>> = {
  /**
   * ✅ Firestore -> App
   * Converte Timestamp/Date/number para epoch (ms).
   * Importante: manter epoch no app evita Timestamp “vazar” para Store/serialização.
   */
  fromFirestore(
    snap: QueryDocumentSnapshot,
    options: SnapshotOptions
  ): Omit<FriendRequest, 'id'> {
    const d: any = snap.data(options);

    return {
      requesterUid: d.requesterUid,
      targetUid: d.targetUid,
      message: d.message ?? null,
      status: d.status,

      // Datas em epoch (ms) no app
      createdAt: toEpoch(d.createdAt),
      respondedAt: toEpoch(d.respondedAt),
      acceptedAt: toEpoch(d.acceptedAt),
      updatedAt: toEpoch(d.updatedAt),
      expiresAt: toEpoch(d.expiresAt),
    };
  },

  /**
   * ✅ App -> Firestore
   * Converte epoch (ms) para Timestamp.
   * Mantém null quando não existir data (mesmo comportamento do seu toTs antigo).
   */
  toFirestore(r: Omit<FriendRequest, 'id'>): DocumentData {
    return {
      requesterUid: r.requesterUid,
      targetUid: r.targetUid,
      message: r.message ?? null,
      status: r.status,

      // Datas como Timestamp no Firestore
      createdAt: toTimestamp(r.createdAt),
      respondedAt: toTimestamp(r.respondedAt),
      acceptedAt: toTimestamp(r.acceptedAt),
      updatedAt: toTimestamp(r.updatedAt),
      expiresAt: toTimestamp(r.expiresAt),
    };
  },
};

/*
Conversões são feitas no src/app/core/utils/epoch-utils.ts

Timestamp/Date/number → epoch (ms) (pra Store / models serializáveis)
epoch (ms) → Timestamp (pra escrita no Firestore, quando necessário)
*/
