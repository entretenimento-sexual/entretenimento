// src/app/core/services/interactions/friendship/repo/facade.repo.ts
// -----------------------------------------------------------------------------
// FRIENDSHIP REPOSITORY FACADE — READ ONLY
// -----------------------------------------------------------------------------
// A fachada expõe apenas consultas. Toda mutação de amizade, solicitação,
// cooldown e bloqueio passa por FriendshipService -> Cloud Functions.
// -----------------------------------------------------------------------------
import { inject, Injectable } from '@angular/core';
import {
  collection,
  CollectionReference,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  QuerySnapshot,
  where,
} from '@angular/fire/firestore';
import { DocumentData } from 'firebase/firestore';
import { from, map, Observable, of } from 'rxjs';

import { IUserDados } from '../../../../interfaces/iuser-dados';
import { BlocksRepo } from './blocks.repo';
import { CooldownRepo } from './cooldown.repo';
import { FriendsRepo } from './friends.repo';
import { RequestsRepo } from './requests.repo';

@Injectable({ providedIn: 'root' })
export class FriendshipRepo {
  private readonly db = inject(Firestore);
  private readonly friends = inject(FriendsRepo);
  private readonly blocks = inject(BlocksRepo);
  private readonly cooldown = inject(CooldownRepo);
  private readonly requests = inject(RequestsRepo);

  /* Friends — leitura */
  getFriendDoc$(a: string, b: string) {
    return this.friends.getFriendDoc$(a, b);
  }

  listFriends(uid: string) {
    return this.friends.listFriends(uid);
  }

  watchFriends(uid: string) {
    return this.friends.watchFriends(uid);
  }

  listFriendsPage(uid: string, pageSize = 24, after: number | null = null) {
    return this.friends.listFriendsPage(uid, pageSize, after);
  }

  /* Blocks — leitura */
  getBlockedDoc$(owner: string, target: string) {
    return this.blocks.getBlockedDoc$(owner, target);
  }

  listBlocked(uid: string) {
    return this.blocks.listBlocked(uid);
  }

  /* Requests — leitura */
  listInboundRequests(uid: string) {
    return this.requests.listInboundRequests(uid);
  }

  listOutboundRequests(uid: string) {
    return this.requests.listOutboundRequests(uid);
  }

  findDuplicatePending(a: string, b: string) {
    return this.requests.findDuplicatePending(a, b);
  }

  watchInboundRequests(uid: string) {
    return this.requests.watchInboundRequests(uid);
  }

  watchOutboundRequests(uid: string) {
    return this.requests.watchOutboundRequests(uid);
  }

  /* Cooldown — leitura */
  readCooldown(a: string, b: string) {
    return this.cooldown.readCooldown(a, b);
  }

  /* Checks reusados no service */
  isAlreadyFriends(a: string, b: string) {
    return this.getFriendDoc$(a, b);
  }

  isBlockedByA(owner: string, target: string) {
    return this.getBlockedDoc$(owner, target);
  }

  /** Busca pública por apelido exclusivamente em /public_profiles. */
  searchUsers(term: string) {
    const normalizedTerm = (term ?? '').trim().toLowerCase();
    if (!normalizedTerm) return of([] as IUserDados[]);

    const profilesCol = collection(
      this.db,
      'public_profiles'
    ) as CollectionReference<DocumentData>;

    const queryRef = query(
      profilesCol,
      where('nicknameNormalized', '>=', normalizedTerm),
      where('nicknameNormalized', '<=', `${normalizedTerm}\uf8ff`)
    );

    return from(getDocs(queryRef)).pipe(
      map((snapshot: QuerySnapshot<DocumentData>) =>
        snapshot.docs.map((documentSnapshot) => {
          const data = documentSnapshot.data() as IUserDados;
          return {
            ...data,
            uid: data.uid ?? documentSnapshot.id,
          } as IUserDados;
        })
      )
    );
  }

  /** Perfil público de terceiro exclusivamente em /public_profiles/{uid}. */
  getUserByUid(uid: string): Observable<IUserDados | null> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return of(null);

    return from(getDoc(doc(this.db, `public_profiles/${safeUid}`))).pipe(
      map((documentSnapshot) => {
        if (!documentSnapshot.exists()) return null;
        const data = documentSnapshot.data() as IUserDados;
        return {
          ...data,
          uid: data.uid ?? documentSnapshot.id,
        } as IUserDados;
      })
    );
  }

  getDocExists(path: string) {
    return this.requests.getDocExists(path);
  }
}
