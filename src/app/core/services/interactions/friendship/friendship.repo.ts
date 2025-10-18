//src\app\core\services\interactions\friendship\friendship.repo.ts
import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Firestore, collection, doc, getDocs, getDoc, query, where,
         addDoc, updateDoc, setDoc, writeBatch, deleteDoc
        } from '@angular/fire/firestore';
import { onSnapshot, Query, Timestamp } from 'firebase/firestore';
import { defer, from, map, Observable } from 'rxjs';
import { Friend } from '../../../interfaces/friendship/friend.interface';
import { FriendRequest } from '../../../interfaces/friendship/friend-request.interface';
import { BlockedUser } from '../../../interfaces/friendship/blocked-user.interface';
import { IUserDados } from '../../../interfaces/iuser-dados';

@Injectable({ providedIn: 'root' })
export class FriendshipRepo {
  private db = inject(Firestore);
  private envInjector = inject(EnvironmentInjector);

  /** Promises do AngularFire dentro do Injection Context */
  private inCtx$<T>(fn: () => Promise<T> | T) {
    return defer(() => runInInjectionContext(this.envInjector, () => from(Promise.resolve(fn()))));
  }
  /** Versão sync para listeners (onSnapshot) */
  private inCtxSync<T>(fn: () => T): T {
    return runInInjectionContext(this.envInjector, fn);
  }

  // ===== Friends =====
  getFriendDoc(requesterUid: string, targetUid: string) {
    return doc(this.db, `users/${requesterUid}/friends/${targetUid}`);
  }
  listFriends(uid: string): Observable<Friend[]> {
    return this.inCtx$(() => getDocs(collection(this.db, `users/${uid}/friends`)))
      .pipe(map(snap => snap.docs.map(d => d.data() as Friend)));
  }

  // ===== Blocked =====
  getBlockedDoc(ownerUid: string, targetUid: string) {
    return doc(this.db, `users/${ownerUid}/blocked/${targetUid}`);
  }
  listBlocked(uid: string): Observable<BlockedUser[]> {
    return this.inCtx$(() => getDocs(collection(this.db, `users/${uid}/blocked`)))
      .pipe(map(snap => snap.docs.map(d => d.data() as BlockedUser)));
  }
  blockUser(ownerUid: string, targetUid: string, reason?: string): Observable<void> {
    const ref = this.getBlockedDoc(ownerUid, targetUid);
    const data: BlockedUser = {
      uid: targetUid,
      reason: (reason ?? '').trim() || undefined,
      blockedAt: Timestamp.fromDate(new Date())
    };
    return this.inCtx$(() => setDoc(ref, data)).pipe(map(() => void 0));
  }
  unblockUser(ownerUid: string, targetUid: string): Observable<void> {
    const ref = this.getBlockedDoc(ownerUid, targetUid);
    return this.inCtx$(() => deleteDoc(ref)).pipe(map(() => void 0));
  }

  // ===== Requests =====
  listInboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.inCtx$(() => {
      const colRef = collection(this.db, 'friendRequests');
      const qRef = query(colRef, where('targetUid', '==', uid), where('status', '==', 'pending'));
      return getDocs(qRef);
    }).pipe(map(snap => snap.docs.map(d => ({ id: d.id, ...(d.data() as FriendRequest) }))));
  }
  listOutboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.inCtx$(() => {
      const colRef = collection(this.db, 'friendRequests');
      const qRef = query(colRef, where('requesterUid', '==', uid), where('status', '==', 'pending'));
      return getDocs(qRef);
    }).pipe(map(snap => snap.docs.map(d => ({ id: d.id, ...(d.data() as FriendRequest) }))));
  }
  findDuplicatePending(requesterUid: string, targetUid: string) {
    return this.inCtx$(() => {
      const colRef = collection(this.db, 'friendRequests');
      const qRef = query(
        colRef,
        where('requesterUid', '==', requesterUid),
        where('targetUid', '==', targetUid),
        where('status', '==', 'pending')
      );
      return getDocs(qRef);
    });
  }
  createRequest(requesterUid: string, targetUid: string, message?: string): Observable<void> {
    const msg = (message ?? '').trim();
    const base: Omit<FriendRequest, 'message'> & Partial<Pick<FriendRequest, 'message'>> = {
      requesterUid,
      targetUid,
      status: 'pending',
      createdAt: Timestamp.fromDate(new Date()),
      ...(msg ? { message: msg } : {}),
    };
    return this.inCtx$(() => addDoc(collection(this.db, 'friendRequests'), base as FriendRequest))
      .pipe(map(() => void 0));
  }
  acceptRequestBatch(requestId: string, requesterUid: string, targetUid: string): Observable<void> {
    const nowTs = Timestamp.fromDate(new Date());
    return this.inCtx$(() => {
      const reqRef = doc(this.db, `friendRequests/${requestId}`);
      const aRef = this.getFriendDoc(requesterUid, targetUid);
      const bRef = this.getFriendDoc(targetUid, requesterUid);
      const a: Friend = { friendUid: targetUid, since: nowTs, lastInteractionAt: nowTs };
      const b: Friend = { friendUid: requesterUid, since: nowTs, lastInteractionAt: nowTs };
      const batch = writeBatch(this.db);
      batch.set(aRef, a);
      batch.set(bRef, b);
      batch.update(reqRef, { status: 'accepted', respondedAt: nowTs });
      return batch.commit();
    }).pipe(map(() => void 0));
  }
  declineRequest(requestId: string): Observable<void> {
    return this.inCtx$(() => {
      const reqRef = doc(this.db, `friendRequests/${requestId}`);
      return updateDoc(reqRef, { status: 'declined', respondedAt: Timestamp.fromDate(new Date()) });
    }).pipe(map(() => void 0));
  }
  cancelOutboundRequest(requestId: string): Observable<void> {
    const ref = doc(this.db, `friendRequests/${requestId}`);
    return this.inCtx$(() => deleteDoc(ref)).pipe(map(() => void 0));
  }

  // ===== Checks =====
  getDocExists(path: string) { return this.inCtx$(() => getDoc(doc(this.db, path))); }
  isAlreadyFriends(requesterUid: string, targetUid: string) {
    return this.inCtx$(() => getDoc(this.getFriendDoc(requesterUid, targetUid)));
  }
  isBlockedByA(owner: string, target: string) {
    return this.inCtx$(() => getDoc(this.getBlockedDoc(owner, target)));
  }

  // ===== Search =====
  searchUsers(term: string): Observable<IUserDados[]> {
    const q = (term ?? '').trim().toLowerCase();
    if (!q) return from(Promise.resolve([]));
    return this.inCtx$(() => {
      const usersCol = collection(this.db, 'users');
      const qRef = query(
        usersCol,
        where('nicknameLower', '>=', q),
        where('nicknameLower', '<=', q + '\uf8ff')
      );
      return getDocs(qRef);
    }).pipe(
      map(snap => snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) } as IUserDados)))
    );
  }
  getUserByUid(uid: string): Observable<IUserDados | null> {
    return this.inCtx$(() => getDoc(doc(this.db, `users/${uid}`)))
      .pipe(map(d => (d.exists() ? ({ uid: d.id, ...(d.data() as any) } as IUserDados) : null)));
  }

  // ===== Realtime =====
  watchInboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return new Observable(sub => {
      const unsubscribe = this.inCtxSync(() => {
        const colRef = collection(this.db, 'friendRequests');
        const qRef = query(colRef, where('targetUid', '==', uid), where('status', '==', 'pending')) as Query;
        return onSnapshot(
          qRef,
          snap => sub.next(snap.docs.map(d => ({ id: d.id, ...(d.data() as FriendRequest) }))),
          err => sub.error(err)
        );
      });
      return () => unsubscribe?.();
    });
  }
}
