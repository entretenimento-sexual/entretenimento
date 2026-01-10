// src/app/core/services/interactions/friendship/repo/friends.repo.ts
import { Injectable, EnvironmentInjector } from '@angular/core';
import { Firestore, doc, getDoc, DocumentReference,
          collection, getDocs, query, limit,
          orderBy,
          startAfter} from '@angular/fire/firestore';
import { FirestoreRepoBase } from './base.repo';
import { Friend } from '../../../../interfaces/friendship/friend.interface';
import { Observable, map } from 'rxjs';
import { CollectionReference, DocumentData, DocumentSnapshot, Timestamp } from 'firebase/firestore';
import { PageResult } from 'src/app/shared/pagination/page.types';

@Injectable({ providedIn: 'root' })
export class FriendsRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector) { super(db, env); }

  private key(a: string, b: string) { return [a, b].sort().join('_'); }

  private ref(a: string, b: string): DocumentReference<Friend> {
    return doc(this.db, `friends/${this.key(a, b)}`) as DocumentReference<Friend>;
  }

  /** valida amizade existente (usa inCtx$ para manter o injection context) */
  getFriendDoc$(a: string, b: string): Observable<DocumentSnapshot<Friend>> {
    return this.inCtx$(() => getDoc(this.ref(a, b)));
  }

  listFriends(uid: string, pageSize = 24) {
    return this.inCtx$(() => {
      const col = collection(this.db, `users/${uid}/friends`);
      const q = query(col, limit(pageSize));
      return getDocs(q);
    }).pipe(map(snap => snap.docs.map(d => d.data() as Friend)));
  }


  /**
  * Página de amigos (ordenado por `since` desc).
  * @param afterSince Valor do último `since` da página anterior (Timestamp). Envie null na 1ª página.
  */
  listFriendsPage(uid: string, pageSize = 24, after: number | null = null) {
    return this.inCtx$(() => {
      const col = collection(this.db, `users/${uid}/friends`) as CollectionReference<DocumentData>;
      // Ordene pelo campo que você tiver índice (ex.: lastInteractionAt: number)
      let qRef = query(col, orderBy('lastInteractionAt', 'desc'), limit(pageSize));
      if (after != null) {
        qRef = query(col, orderBy('lastInteractionAt', 'desc'), startAfter(after), limit(pageSize));
      }
      return getDocs(qRef);
    }).pipe(map(snap => {
      const docs = snap.docs.map(d => d.data() as any);
      const items = docs as any[]; // tipar como Friend se preferir
      const last = docs.at(-1)?.lastInteractionAt;
      const nextAfter = typeof last === 'number'
        ? last
        : (typeof last?.toMillis === 'function' ? last.toMillis() : null);
      const reachedEnd = docs.length < pageSize;
      return { items, nextAfter, reachedEnd };
    }));
  }
}
