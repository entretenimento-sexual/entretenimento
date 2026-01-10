// src/app/core/services/interactions/friendship/repo/facade.repo.ts
import { Injectable, inject } from '@angular/core';
import {
  Firestore, collection, getDocs, query, where,
  doc, getDoc, CollectionReference, QuerySnapshot
} from '@angular/fire/firestore';
import { DocumentData } from 'firebase/firestore';
import { FriendsRepo } from './friends.repo';
import { BlocksRepo } from './blocks.repo';
import { CooldownRepo } from './cooldown.repo';
import { RequestsRepo } from './requests.repo';
import { map, from, Observable } from 'rxjs';
import { IUserDados } from '../../../../interfaces/iuser-dados';

@Injectable({ providedIn: 'root' })
export class FriendshipRepo {
  private db = inject(Firestore);
  private friends = inject(FriendsRepo);
  private blocks = inject(BlocksRepo);
  private cd = inject(CooldownRepo);
  private reqs = inject(RequestsRepo);

  /* Friends */
  getFriendDoc$(a: string, b: string) { return this.friends.getFriendDoc$(a, b); }
  listFriends(uid: string) { return this.friends.listFriends(uid); }

  /* Blocks */
  getBlockedDoc$(owner: string, target: string) { return this.blocks.getBlockedDoc$(owner, target); }
  listBlocked(uid: string) { return this.blocks.listBlocked(uid); }
  blockUser(owner: string, target: string, reason?: string) { return this.blocks.blockUser(owner, target, reason); }
  unblockUser(owner: string, target: string) { return this.blocks.unblockUser(owner, target); }

  /* Requests */
  listInboundRequests(uid: string) { return this.reqs.listInboundRequests(uid); }
  listOutboundRequests(uid: string) { return this.reqs.listOutboundRequests(uid); }
  findDuplicatePending(a: string, b: string) { return this.reqs.findDuplicatePending(a, b); }
  createRequest(a: string, b: string, m?: string) { return this.reqs.createRequest(a, b, m); }
  acceptRequestBatch(id: string, a: string, b: string) { return this.reqs.acceptRequestBatch(id, a, b); }
  declineRequest(id: string) { return this.reqs.declineRequest(id); }
  declineRequestWithCooldown(id: string, ms: number) { return this.reqs.declineRequestWithCooldown(id, ms); }
  cancelOutboundRequest(id: string) { return this.reqs.cancelOutboundRequest(id); }
  watchInboundRequests(uid: string) { return this.reqs.watchInboundRequests(uid); }
  watchOutboundRequests(uid: string) { return this.reqs.watchOutboundRequests(uid); }

  /* Cooldown */
  readCooldown(a: string, b: string) { return this.cd.readCooldown(a, b); }
  setCooldown(a: string, b: string, until: Date) { return this.cd.setCooldown(a, b, until); }

  /* Checks reusados no service */
  isAlreadyFriends(a: string, b: string) { return this.getFriendDoc$(a, b); }
  isBlockedByA(owner: string, target: string) { return this.getBlockedDoc$(owner, target); }

  /* Busca direta via Firestore */
  searchUsers(term: string) {
    const q = (term ?? '').trim().toLowerCase();
    if (!q) return from(Promise.resolve([] as IUserDados[]));
    const usersCol = collection(this.db, 'users') as CollectionReference<DocumentData>;
    const qRef = query(usersCol, where('nicknameLower', '>=', q), where('nicknameLower', '<=', q + '\uf8ff'));
    return from(getDocs(qRef)).pipe(
      map((snap: QuerySnapshot<DocumentData>) =>
        snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) } as IUserDados))
      )
    );
  }

  getUserByUid(uid: string): Observable<IUserDados | null> {
    return from(getDoc(doc(this.db, `users/${uid}`))).pipe(
      map(d => (d.exists() ? ({ uid: d.id, ...(d.data() as any) } as IUserDados) : null))
    );
  }

  listFriendsPage(uid: string, pageSize = 24, after: number | null = null) {
    return this.friends.listFriendsPage(uid, pageSize, after);
  }

  /* util */
  getDocExists(path: string) { return this.reqs.getDocExists(path); }
}
