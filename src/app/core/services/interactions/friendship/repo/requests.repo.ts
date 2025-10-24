// src/app/core/services/interactions/friendship/repo/requests.repo.ts
import { Injectable, EnvironmentInjector } from '@angular/core';
import { Firestore, addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, where, writeBatch } from '@angular/fire/firestore';
import { FirestoreRepoBase } from './base.repo';
import { Friend } from '../../../../interfaces/friendship/friend.interface';
import { FriendRequest } from '../../../../interfaces/friendship/friend-request.interface';
import { Observable, map, switchMap } from 'rxjs';
import { onSnapshot, Query as FsQuery, Timestamp } from 'firebase/firestore';
import { CooldownRepo } from './cooldown.repo';

@Injectable({ providedIn: 'root' })
export class RequestsRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector, private cooldown: CooldownRepo) {
    super(db, env);
  }

  getDocExists(path: string) {
    return this.inCtx$(() => getDoc(doc(this.db, path))).pipe(map(s => s.exists()));
  }

  listInboundRequests(uid: string) {
    return this.inCtx$(() => {
      const colRef = collection(this.db, 'friendRequests');
      const qRef = query(colRef, where('targetUid', '==', uid), where('status', '==', 'pending'));
      return getDocs(qRef);
    }).pipe(map(snap => snap.docs.map(d => ({ id: d.id, ...(d.data() as FriendRequest) }))));
  }

  listOutboundRequests(uid: string) {
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

  createRequest(requesterUid: string, targetUid: string, message?: string) {
    const msg = (message ?? '').trim();
    const base: Omit<FriendRequest, 'message'> & Partial<Pick<FriendRequest, 'message'>> = {
      requesterUid, targetUid, status: 'pending',
      createdAt: Timestamp.fromDate(new Date()),
      ...(msg ? { message: msg } : {}),
    };
    return this.inCtx$(() => addDoc(collection(this.db, 'friendRequests'), base as FriendRequest))
      .pipe(map(() => void 0));
  }

  acceptRequestBatch(requestId: string, requesterUid: string, targetUid: string) {
    const nowTs = Timestamp.fromDate(new Date());
    return this.inCtx$(() => {
      const reqRef = doc(this.db, `friendRequests/${requestId}`);
      const aRef = doc(this.db, `users/${requesterUid}/friends/${targetUid}`);
      const bRef = doc(this.db, `users/${targetUid}/friends/${requesterUid}`);
      const a: Friend = { friendUid: targetUid, since: nowTs, lastInteractionAt: nowTs };
      const b: Friend = { friendUid: requesterUid, since: nowTs, lastInteractionAt: nowTs };
      const batch = writeBatch(this.db);
      batch.set(aRef, a);
      batch.set(bRef, b);
      batch.update(reqRef, { status: 'accepted', respondedAt: nowTs });
      return batch.commit();
    }).pipe(map(() => void 0));
  }

  declineRequest(requestId: string) {
    return this.inCtx$(() => {
      const reqRef = doc(this.db, `friendRequests/${requestId}`);
      return writeBatch(this.db).update(reqRef, {
        status: 'declined',
        respondedAt: Timestamp.fromDate(new Date())
      }).commit();
    }).pipe(map(() => void 0));
  }

  /** recusa + cooldown (usa CooldownRepo) */
  declineRequestWithCooldown(requestId: string, cooldownMs: number) {
    const now = new Date();
    const until = new Date(now.getTime() + cooldownMs);
    return this.inCtx$(() => getDocs(query(collection(this.db, 'friendRequests'), where('__name__', '==', requestId))))
      .pipe(
        switchMap(snap => {
          const d = snap.docs[0];
          if (!d) throw new Error('Pedido não encontrado.');
          const data = d.data() as FriendRequest;
          const { requesterUid, targetUid } = data;

          return this.inCtx$(() => {
            const batch = writeBatch(this.db);
            // request -> declined
            batch.update(doc(this.db, `friendRequests/${requestId}`), {
              status: 'declined',
              respondedAt: Timestamp.fromDate(now),
            });
            // cooldown
            batch.set(this.cooldown.getCooldownRef(requesterUid, targetUid), {
              requesterUid, targetUid,
              until: Timestamp.fromDate(until),
              expiresAt: Timestamp.fromDate(until),
            });
            return batch.commit();
          });
        }),
        map(() => void 0)
      );
  }

  cancelOutboundRequest(requestId: string) {
    return this.inCtx$(() => deleteDoc(doc(this.db, `friendRequests/${requestId}`))).pipe(map(() => void 0));
  }

  watchInboundRequests(uid: string) {
    return new Observable<(FriendRequest & { id: string })[]>(sub => {
      const unsubscribe = this.inCtxSync(() => {
        const colRef = collection(this.db, 'friendRequests');
        const qRef = query(colRef, where('targetUid', '==', uid), where('status', '==', 'pending')) as FsQuery;
        return onSnapshot(
          qRef,
          snap => sub.next(snap.docs.map(d => ({ id: d.id, ...(d.data() as FriendRequest) }))),
          err => sub.error(err)
        );
      });
      return () => unsubscribe?.();
    });
  }

  watchOutboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return new Observable(sub => {
      const unsubscribe = this.inCtxSync(() => {
        const colRef = collection(this.db, 'friendRequests');
        const qRef = query(colRef, where('requesterUid', '==', uid), where('status', '==', 'pending')) as FsQuery;
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
