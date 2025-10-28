// src/app/core/services/data-handling/converters/user.firestore-converter.ts
import {
  FirestoreDataConverter, Timestamp, DocumentData, QueryDocumentSnapshot, SnapshotOptions
} from 'firebase/firestore';
import { IUserDados } from '../../../interfaces/iuser-dados';

const toMillis = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  return null;
};

const toTs = (ms: number | null | undefined) =>
  ms != null ? Timestamp.fromMillis(ms) : null;

export const userConverter: FirestoreDataConverter<IUserDados> = {
  fromFirestore(snap: QueryDocumentSnapshot, options: SnapshotOptions): IUserDados {
    const d: any = snap.data(options);
    const ms = (x: any) => toMillis(x) ?? null;

    return {
      uid: snap.id,
      ...d,

      // 🔁 TUDO como epoch (ms)
      lastLogin: ms(d.lastLogin) ?? 0,
      firstLogin: ms(d.firstLogin),
      createdAt: ms(d.createdAt),
      subscriptionExpires: ms(d.subscriptionExpires),
      lastSeen: ms(d.lastSeen),
      lastLocationAt: ms(d.lastLocationAt),
      registrationDate: ms(d.registrationDate),
      lastOfflineAt: ms(d.lastOfflineAt),
      lastOnlineAt: ms(d.lastOnlineAt),

      // ✅ NORMALIZA acceptedTerms
      ...(d.acceptedTerms ? {
        acceptedTerms: {
          accepted: !!d.acceptedTerms.accepted,
          date: ms(d.acceptedTerms.date),
        }
      } : {}),

      // (opcional) histórico também normalizado, se existir
      ...(Array.isArray(d.nicknameHistory) ? {
        nicknameHistory: d.nicknameHistory.map((it: any) => ({
          nickname: it?.nickname ?? '',
          date: ms(it?.date),
        }))
      } : {}),

    } as IUserDados; // TS: ok mesmo com campos extras
  },

  toFirestore(u: IUserDados): DocumentData {
    return {
      ...u,

      // ↩️ converter de volta para Timestamp ao persistir
      lastLogin: toTs(u.lastLogin),
      firstLogin: toTs(u.firstLogin ?? null),
      createdAt: toTs(u.createdAt ?? null),
      subscriptionExpires: toTs(u.subscriptionExpires ?? null),
      lastSeen: toTs(u.lastSeen ?? null),
      lastLocationAt: toTs(u.lastLocationAt ?? null),
      registrationDate: toTs(u.registrationDate ?? null),
      lastOfflineAt: toTs(u.lastOfflineAt ?? null),
      lastOnlineAt: toTs(u.lastOnlineAt ?? null),

      ...(u as any).acceptedTerms ? {
        acceptedTerms: {
          accepted: !!(u as any).acceptedTerms.accepted,
          date: toTs((u as any).acceptedTerms.date ?? null),
        }
      } : {},

      ...(Array.isArray((u as any).nicknameHistory) ? {
        nicknameHistory: (u as any).nicknameHistory.map((it: any) => ({
          nickname: it?.nickname ?? '',
          date: toTs(it?.date ?? null),
        }))
      } : {}),
    };
  }
};
