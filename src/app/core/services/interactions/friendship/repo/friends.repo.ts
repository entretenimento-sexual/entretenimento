// src/app/core/services/interactions/friendship/repo/friends.repo.ts
import { Injectable, EnvironmentInjector } from '@angular/core';
import {
  Firestore, doc, getDoc, DocumentReference,
  collection, getDocs
} from '@angular/fire/firestore';
import { FirestoreRepoBase } from './base.repo';
import { Friend } from '../../../../interfaces/friendship/friend.interface';
import { Observable, map } from 'rxjs';
import { DocumentSnapshot } from 'firebase/firestore'; // ou do @angular/fire se preferir

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

  listFriends(uid: string) {
    return this.inCtx$(() => getDocs(collection(this.db, `users/${uid}/friends`)))
      .pipe(map((snap) => snap.docs.map(d => d.data() as Friend)));
  }
}
