// src/app/core/services/data-handling/converters/user.firestore-converter.ts
// Conversor Firestore para documentos de usuário
// Não esquecer os comentários e ferramentas de debug para facilitar a manutenção futura
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
  fromFirestore(snap, options): IUserDados {
    const d: any = snap.data(options);
    const ms = (x: any) => toMillis(x) ?? null;

    return {
      ...d,
      uid: snap.id, // ✅ nunca é sobrescrito

      lastLogin: ms(d.lastLogin) ?? 0,
      firstLogin: ms(d.firstLogin),
      createdAt: ms(d.createdAt),
      subscriptionExpires: ms(d.subscriptionExpires),
      lastSeen: ms(d.lastSeen),
      lastLocationAt: ms(d.lastLocationAt),
      registrationDate: ms(d.registrationDate),
      lastOfflineAt: ms(d.lastOfflineAt),
      lastOnlineAt: ms(d.lastOnlineAt),

      ...(d.acceptedTerms ? {
        acceptedTerms: {
          accepted: !!d.acceptedTerms.accepted,
          date: ms(d.acceptedTerms.date),
        }
      } : {}),

      ...(Array.isArray(d.nicknameHistory) ? {
        nicknameHistory: d.nicknameHistory.map((it: any) => ({
          nickname: it?.nickname ?? '',
          date: ms(it?.date),
        }))
      } : {}),
    } as IUserDados;
  },

  toFirestore(u: IUserDados): DocumentData {
    const {
      lastLogin,
      firstLogin,
      createdAt,
      subscriptionExpires,
      lastSeen,
      lastLocationAt,
      registrationDate,
      lastOfflineAt,
      lastOnlineAt,
      acceptedTerms,
      nicknameHistory,
      ...rest
    } = u;

    return {
      ...rest,

      ...(lastLogin > 0 ? { lastLogin: toTs(lastLogin) } : {}),
      ...(firstLogin ? { firstLogin: toTs(firstLogin) } : {}),
      ...(createdAt ? { createdAt: toTs(createdAt) } : {}),
      ...(subscriptionExpires ? { subscriptionExpires: toTs(subscriptionExpires) } : {}),
      ...(lastSeen ? { lastSeen: toTs(lastSeen) } : {}),
      ...(lastLocationAt ? { lastLocationAt: toTs(lastLocationAt) } : {}),
      ...(registrationDate ? { registrationDate: toTs(registrationDate) } : {}),
      ...(lastOfflineAt ? { lastOfflineAt: toTs(lastOfflineAt) } : {}),
      ...(lastOnlineAt ? { lastOnlineAt: toTs(lastOnlineAt) } : {}),

      ...(acceptedTerms ? {
        acceptedTerms: {
          accepted: !!acceptedTerms.accepted,
          date: toTs(acceptedTerms.date ?? null),
        }
      } : {}),

      ...(Array.isArray(nicknameHistory) ? {
        nicknameHistory: nicknameHistory.map(it => ({
          nickname: it?.nickname ?? '',
          date: toTs(it?.date ?? null),
        }))
      } : {}),
    };
  },
};
