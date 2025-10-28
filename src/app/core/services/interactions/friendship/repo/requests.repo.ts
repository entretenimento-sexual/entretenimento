// src/app/core/services/interactions/friendship/repo/requests.repo.ts
import { Injectable, EnvironmentInjector } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  runTransaction,
  serverTimestamp,
  updateDoc
} from '@angular/fire/firestore';
import {
  onSnapshot,
  Query as FsQuery,
  Timestamp,
  DocumentData
} from 'firebase/firestore';
import { Observable, map, switchMap } from 'rxjs';

import { FirestoreRepoBase } from './base.repo';
import { Friend } from '../../../../interfaces/friendship/friend.interface';
import { FriendRequest } from '../../../../interfaces/friendship/friend-request.interface';
import { CooldownRepo } from './cooldown.repo';

@Injectable({ providedIn: 'root' })
export class RequestsRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector, private cooldown: CooldownRepo) {
    super(db, env);
  }

  getDocExists(path: string) {
    return this.inCtx$(() => getDoc(doc(this.db, path))).pipe(map(s => s.exists()));
  }

  /* =========================
   * LISTAGENS (pendentes)
   * ========================= */
  listInboundRequests(uid: string) {
    return this.inCtx$(() => {
      const colRef = collection(this.db, 'friendRequests');
      const qRef = query(colRef, where('targetUid', '==', uid), where('status', '==', 'pending'));
      return getDocs(qRef);
    }).pipe(
      map(snap =>
        snap.docs.map(d => {
          const data = d.data() as Omit<FriendRequest, 'id'>;
          return { id: d.id, ...data };
        })
      )
    );
  }

  listOutboundRequests(uid: string) {
    return this.inCtx$(() => {
      const colRef = collection(this.db, 'friendRequests');
      const qRef = query(colRef, where('requesterUid', '==', uid), where('status', '==', 'pending'));
      return getDocs(qRef);
    }).pipe(
      map(snap =>
        snap.docs.map(d => {
          const data = d.data() as Omit<FriendRequest, 'id'>;
          return { id: d.id, ...data };
        })
      )
    );
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

  /* =========================
   * CRIAÇÃO
   * ========================= */
  /** Cria uma solicitação com timestamps do servidor (anti clock-skew) */
  createRequest(requesterUid: string, targetUid: string, message?: string) {
    const base: DocumentData = {
      requesterUid,
      targetUid,
      message: (message ?? '').trim() || null,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    return this.inCtx$(() => addDoc(collection(this.db, 'friendRequests'), base))
      .pipe(map(() => void 0));
  }

  /* =========================
   * ACEITAR / RECUSAR / CANCELAR
   * ========================= */
  /**
   * Aceitar:
   * - valida request 'pending'
   * - impede race verificando amizade
   * - cria as 2 arestas (users/A/friends/B, users/B/friends/A)
   * - marca request accepted + respondedAt + updatedAt
   * Tudo em transação.
   */
  acceptRequestBatch(requestId: string, requesterUid: string, targetUid: string) {
    return this.inCtx$(() =>
      runTransaction(this.db, async (tx) => {
        const reqRef = doc(this.db, `friendRequests/${requestId}`);
        const aRef = doc(this.db, `users/${requesterUid}/friends/${targetUid}`);
        const bRef = doc(this.db, `users/${targetUid}/friends/${requesterUid}`);

        const reqSnap = await tx.get(reqRef);
        if (!reqSnap.exists()) throw new Error('Solicitação inexistente.');
        const req = reqSnap.data() as FriendRequest;
        if (req.status !== 'pending') throw new Error('Solicitação não está pendente.');
        if (req.requesterUid !== requesterUid || req.targetUid !== targetUid) {
          throw new Error('Dados da solicitação não correspondem.');
        }

        const [aSnap, bSnap] = await Promise.all([tx.get(aRef), tx.get(bRef)]);
        if (aSnap.exists() || bSnap.exists()) throw new Error('Vocês já são amigos.');

        const since = serverTimestamp() as unknown as Timestamp;

        const a: Friend = { friendUid: targetUid, since, lastInteractionAt: since };
        const b: Friend = { friendUid: requesterUid, since, lastInteractionAt: since };

        tx.set(aRef, a, { merge: true });
        tx.set(bRef, b, { merge: true });

        tx.update(reqRef, {
          status: 'accepted',
          acceptedAt: serverTimestamp(),
          respondedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      })
    ).pipe(map(() => void 0));
  }

  /** Recusa (soft) */
  declineRequest(requestId: string) {
    return this.inCtx$(() => {
      const reqRef = doc(this.db, `friendRequests/${requestId}`);
      return updateDoc(reqRef, {
        status: 'declined',
        respondedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }).pipe(map(() => void 0));
  }

  /** Recusa + aplica cooldown (grava doc em collection de cooldowns) */
  declineRequestWithCooldown(requestId: string, cooldownMs: number) {
    return this.inCtx$(() => getDoc(doc(this.db, `friendRequests/${requestId}`))).pipe(
      switchMap(snap => {
        if (!snap.exists()) throw new Error('Pedido não encontrado.');
        const data = snap.data() as FriendRequest;
        const { requesterUid, targetUid } = data;

        const until = new Date(Date.now() + cooldownMs);
        const untilTs = Timestamp.fromDate(until);

        return this.inCtx$(() => {
          const batch = writeBatch(this.db);
          // request -> declined
          batch.update(doc(this.db, `friendRequests/${requestId}`), {
            status: 'declined',
            respondedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          // cooldown
          batch.set(this.cooldown.getCooldownRef(requesterUid, targetUid), {
            requesterUid, targetUid,
            until: untilTs,
            expiresAt: untilTs,
          }, { merge: true });

          return batch.commit();
        });
      }),
      map(() => void 0)
    );
  }

  /** Cancelar enviada (soft por padrão; passe soft=false p/ hard delete) */
  cancelOutboundRequest(requestId: string, soft = true) {
    if (!soft) {
      return this.inCtx$(() => deleteDoc(doc(this.db, `friendRequests/${requestId}`)))
        .pipe(map(() => void 0));
    }
    return this.inCtx$(() => {
      const reqRef = doc(this.db, `friendRequests/${requestId}`);
      return updateDoc(reqRef, {
        status: 'canceled',
        respondedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }).pipe(map(() => void 0));
  }

  /* =========================
   * REALTIME WATCHERS
   * ========================= */
  watchInboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return new Observable(sub => {
      const unsubscribe = this.inCtxSync(() => {
        const colRef = collection(this.db, 'friendRequests');
        const qRef = query(colRef, where('targetUid', '==', uid), where('status', '==', 'pending')) as unknown as FsQuery;
        return onSnapshot(
          qRef,
          snap => sub.next(
            snap.docs.map(d => {
              const data = d.data() as Omit<FriendRequest, 'id'>;
              return { id: d.id, ...data };
            })
          ),
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
        const qRef = query(colRef, where('requesterUid', '==', uid), where('status', '==', 'pending')) as unknown as FsQuery;
        return onSnapshot(
          qRef,
          snap => sub.next(
            snap.docs.map(d => {
              const data = d.data() as Omit<FriendRequest, 'id'>;
              return { id: d.id, ...data };
            })
          ),
          err => sub.error(err)
        );
      });
      return () => unsubscribe?.();
    });
  }
}
