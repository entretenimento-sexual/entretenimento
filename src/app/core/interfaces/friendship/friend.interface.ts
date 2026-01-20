// src/app/core/interfaces/friendship/friend.interface.ts
import type { Timestamp, WithFieldValue } from 'firebase/firestore';

export interface FriendDoc {
  friendUid: string;
  since?: Timestamp;
  lastInteractionAt?: Timestamp;
  nickname?: string;
  distanceKm?: number;
}

/** ✅ Tipo serializável (Store/UI) */
export interface Friend {
  friendUid: string;
  since?: number | null;
  lastInteractionAt?: number | null;
  nickname?: string;
  distanceKm?: number;
}

/** ✅ Para writes no Firestore (aceita serverTimestamp()) */
export type FriendDocWrite = WithFieldValue<FriendDoc>;

/*

//separação “tipo do Firestore” vs “tipo serializável (Store/UI)”

// serverTimestamp() não é Timestamp
(é um FieldValue placeholder que vira Timestamp só depois que o Firestore grava).

//Friend foi declarado explicitamente como serializável(number | null),
  então ele não pode receber Timestamp / FieldValue.

// misturar esses mundos num único tipo normalmente vira um “union”
   gigante que vaza Firestore pro Store / UI e bagunça a previsibilidade / serialização.
 */
