// src/app/core/services/data-handling/converters/user.firestore-converter.ts
// Este arquivo define o userConverter, que é um FirestoreDataConverter para a interface IUserDados.
// Ele é responsável por converter os dados do Firestore para IUserDados e vice-versa,
// garantindo que os campos de data sejam corretamente convertidos para epoch (ms) e
// para Timestamp do Firestore.
// O userConverter deve ser usado sempre que interagir com documentos de usuário no Firestore,
// seja para leitura (get) ou escrita (set/update), para garantir consistência e evitar erros de tipo.
// Ele também lida com campos opcionais e históricos, como acceptedTerms e nicknameHistory,
// garantindo que sejam convertidos corretamente mesmo quando ausentes ou em formatos variados.
// Lembre-se de manter a lógica de conversão centralizada aqui, para evitar duplicação e inconsistências em outras partes do código.
import {
  FirestoreDataConverter, DocumentData, QueryDocumentSnapshot, SnapshotOptions
} from 'firebase/firestore';
import { IUserDados } from '../../../interfaces/iuser-dados';
import { toEpoch, toTimestamp } from 'src/app/core/utils/epoch-utils';

export const userConverter: FirestoreDataConverter<IUserDados> = {
  fromFirestore(snap: QueryDocumentSnapshot, options: SnapshotOptions): IUserDados {
    const d: any = snap.data(options);

    const ms = (x: any) => toEpoch(x) ?? null;

    return {
      ...d,
      uid: snap.id,

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
        acceptedTerms: { accepted: !!d.acceptedTerms.accepted, date: ms(d.acceptedTerms.date) }
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

    const ts = (v: any) => toTimestamp(v);

    return {
      ...rest,

      ...(lastLogin > 0 ? { lastLogin: ts(lastLogin) } : {}),
      ...(firstLogin ? { firstLogin: ts(firstLogin) } : {}),
      ...(createdAt ? { createdAt: ts(createdAt) } : {}),
      ...(subscriptionExpires ? { subscriptionExpires: ts(subscriptionExpires) } : {}),
      ...(lastSeen ? { lastSeen: ts(lastSeen) } : {}),
      ...(lastLocationAt ? { lastLocationAt: ts(lastLocationAt) } : {}),
      ...(registrationDate ? { registrationDate: ts(registrationDate) } : {}),
      ...(lastOfflineAt ? { lastOfflineAt: ts(lastOfflineAt) } : {}),
      ...(lastOnlineAt ? { lastOnlineAt: ts(lastOnlineAt) } : {}),

      ...(acceptedTerms ? {
        acceptedTerms: { accepted: !!acceptedTerms.accepted, date: ts(acceptedTerms.date ?? null) }
      } : {}),

      ...(Array.isArray(nicknameHistory) ? {
        nicknameHistory: nicknameHistory.map(it => ({
          nickname: it?.nickname ?? '',
          date: ts(it?.date ?? null),
        }))
      } : {}),
    };
  },
}; // Linha 84 - fim do user.firestore-converter..
// O userConverter é o ponto central para garantir que a leitura e escrita de IUserDados no Firestore
// seja consistente, especialmente em relação aos campos de data/epoch.
// Ele deve ser usado sempre que interagir com documentos de usuário no Firestore,
// seja para leitura (get) ou escrita (set/update).
