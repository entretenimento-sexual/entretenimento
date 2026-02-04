// src/app/core/services/interactions/friendship/repo/friends.repo.ts
// Não esquecer comentários e ferramentas de debug
import { Injectable, EnvironmentInjector } from '@angular/core';
import {
  Firestore, doc, getDoc, DocumentReference,
  collection, getDocs, query, limit, orderBy, startAfter
} from '@angular/fire/firestore';
import { FirestoreRepoBase } from './base.repo';
import type { FriendDoc, Friend } from '../../../../interfaces/friendship/friend.interface';
import { Observable, map } from 'rxjs';
import { CollectionReference, DocumentData, DocumentSnapshot, Timestamp } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { sanitizeFriendForStore } from 'src/app/store/utils/friend-store.serializer';
import { toEpoch } from '../../../../utils/epoch-utils';

@Injectable({ providedIn: 'root' })
export class FriendsRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector) { super(db, env); }

  private debug = !environment.production;
  private dbg(msg: string, extra?: unknown) {
    if (this.debug) console.log(`[FriendsRepo] ${msg}`, extra ?? '');
  }

  private key(a: string, b: string) { return [a, b].sort().join('_'); }

  private ref(a: string, b: string): DocumentReference<FriendDoc> {
    return doc(this.db, `friends/${this.key(a, b)}`) as DocumentReference<FriendDoc>;
  }

  /** valida amizade existente (mantém injection context) */
  getFriendDoc$(a: string, b: string): Observable<DocumentSnapshot<FriendDoc>> {
    return this.inCtx$(() => getDoc(this.ref(a, b)));
  }

  /** Lista simples (Store-safe) */
  listFriends(uid: string, pageSize = 24): Observable<Friend[]> {
    return this.inCtx$(() => {
      const col = collection(this.db, `users/${uid}/friends`);
      const q = query(col, limit(pageSize));
      return getDocs(q);
    }).pipe(
      map(snap => {
        const docs = snap.docs.map(d => d.data() as FriendDoc);
        const items = docs.map(sanitizeFriendForStore);
        this.dbg('listFriends', { uid, count: items.length });
        return items;
      })
    );
  }

  /**
   * Página de amigos (ordenado por lastInteractionAt desc).
   * Store usa epoch (number). Firestore pode usar Timestamp.
   */
  listFriendsPage(uid: string, pageSize = 24, after: number | null = null) {
    return this.inCtx$(() => {
      const col = collection(this.db, `users/${uid}/friends`) as CollectionReference<DocumentData>;

      // ordenado por campo (Timestamp no Firestore)
      let qRef = query(col, orderBy('lastInteractionAt', 'desc'), limit(pageSize));

      if (after != null) {
        const cursor = Timestamp.fromMillis(after); // ✅ epoch -> Timestamp
        qRef = query(col, orderBy('lastInteractionAt', 'desc'), startAfter(cursor), limit(pageSize));
      }

      return getDocs(qRef);
    }).pipe(
      map(snap => {
        const docs = snap.docs.map(d => d.data() as FriendDoc);
        const items: Friend[] = docs.map(sanitizeFriendForStore);

        const lastRaw = docs.at(-1)?.lastInteractionAt;
        const nextAfter = toEpoch(lastRaw); // ✅ Timestamp -> epoch (number|null)

        const reachedEnd = docs.length < pageSize;

        this.dbg('listFriendsPage', { uid, pageSize, after, returned: items.length, nextAfter, reachedEnd });
        return { items, nextAfter, reachedEnd };
      })
    );
  }
}
