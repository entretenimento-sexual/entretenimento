// src/app/core/services/interactions/friendship.service.ts
import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, doc, getDocs, query, where, addDoc, updateDoc,
  setDoc, Timestamp,
} from '@angular/fire/firestore';
import { defer, from, map, switchMap, throwError, tap } from 'rxjs';
import { Friend } from '../../interfaces/friendship/friend.interface';
import { FriendRequest } from '../../interfaces/friendship/friend-request.interface';
import { BlockedUser } from '../../interfaces/friendship/blocked-user.interface';
import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class FriendshipService {
  // 🔁 usamos inject() para garantir o acesso aos providers e ao EnvironmentInjector
  private db = inject(Firestore);
  private notifier = inject(ErrorNotificationService);
  private envInjector = inject(EnvironmentInjector);

  constructor() { } // construtor vazio para manter providedIn e tree-shaking

  /** Log auxiliar só em dev */
  private dbg(msg: string, extra?: unknown) {
    if (!environment.production) {
      console.log(`[FRIENDSHIP] ${msg}`, extra ?? '');
    }
  }

  /**
   * Helper: garante que qualquer chamada Firebase rode dentro de um Injection Context.
   * Uso: this.inCtx(() => getDocs(q))
   */
  /** Executa qualquer código AngularFire (incluindo criação de refs) dentro de Injection Context */
  private inCtx$<T>(fn: () => Promise<T> | T) {
    return defer(() =>
      runInInjectionContext(this.envInjector, () => from(Promise.resolve(fn())))
    );
  }

  /** Envia uma solicitação de amizade */
  sendRequest(requesterUid: string, targetUid: string, message?: string) {
    if (!requesterUid || !targetUid || requesterUid === targetUid) {
      return throwError(() => new Error('[FRIENDSHIP] requesterUid/targetUid inválidos'));
    }

    this.dbg('sendRequest → validating duplicates', { requesterUid, targetUid });

    return this.inCtx$(() => {
      const col = collection(this.db, 'friendRequests');
      const q = query(
        col,
        where('requesterUid', '==', requesterUid),
        where('targetUid', '==', targetUid),
        where('status', '==', 'pending')
      );
      return getDocs(q);
    }).pipe(
      switchMap((snap) => {
        if (!snap.empty) {
          this.dbg('sendRequest → duplicate pending found');
          return throwError(() => new Error('Já existe uma solicitação pendente.'));
        }

        const req: FriendRequest = {
          requesterUid,
          targetUid,
          message,
          status: 'pending',
          createdAt: Timestamp.fromDate(new Date()),
        };

        this.dbg('sendRequest → creating', req);

        return this.inCtx$(() => {
          const col = collection(this.db, 'friendRequests');
          return addDoc(col, req);
        }).pipe(
          tap(() => this.notifier.showSuccess('Solicitação de amizade enviada.')),
          map(() => void 0)
        );
      })
    );
  }

  /** Aceita uma solicitação e cria a relação nos dois lados */
  acceptRequest(requestId: string, requesterUid: string, targetUid: string) {
    const now = Date.now();
    const nowTs = Timestamp.fromMillis(now);

    this.dbg('acceptRequest → create reciprocal friendship', { requestId, requesterUid, targetUid });

    return this.inCtx$(() => {
      const reqRef = doc(this.db, `friendRequests/${requestId}`);
      const aRef = doc(this.db, `users/${requesterUid}/friends/${targetUid}`);
      const bRef = doc(this.db, `users/${targetUid}/friends/${requesterUid}`);

      const a: Friend = { friendUid: targetUid, since: nowTs, lastInteractionAt: nowTs };
      const b: Friend = { friendUid: requesterUid, since: nowTs, lastInteractionAt: nowTs };

      return setDoc(aRef, a)
        .then(() => setDoc(bRef, b))
        .then(() => updateDoc(reqRef, { status: 'accepted', respondedAt: nowTs }));
    }).pipe(
      tap(() => this.notifier.showSuccess('Solicitação aceita. Agora vocês são amigos!')),
      map(() => void 0)
    );
  }

  /** Recusa uma solicitação */
  declineRequest(requestId: string) {
    this.dbg('declineRequest', { requestId });
    return this.inCtx$(() => {
      const reqRef = doc(this.db, `friendRequests/${requestId}`);
      return updateDoc(reqRef, { status: 'declined', respondedAt: Timestamp.fromDate(new Date()) });
    }).pipe(
      tap(() => this.notifier.showInfo('Solicitação de amizade recusada.')),
      map(() => void 0)
    );
  }

  /** Lista solicitações recebidas (pendentes) do usuário atual */
  listInboundRequests(uid: string) {
    this.dbg('listInboundRequests', { uid });

    return this.inCtx$(() => {
      const col = collection(this.db, 'friendRequests');
      const q = query(col, where('targetUid', '==', uid), where('status', '==', 'pending'));
      return getDocs(q);
    }).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as FriendRequest) })))
    );
  }

  /** Lista amigos do usuário atual */
  listFriends(uid: string) {
    this.dbg('listFriends', { uid });
    return this.inCtx$(() => {
      const col = collection(this.db, `users/${uid}/friends`);
      return getDocs(col);
    }).pipe(map(snap => snap.docs.map(d => d.data() as Friend)));
  }

  /** Bloquear usuário */
  blockUser(ownerUid: string, targetUid: string, reason?: string) {
    this.dbg('blockUser', { ownerUid, targetUid, reason });
    return this.inCtx$(() => {
      const ref = doc(this.db, `users/${ownerUid}/blocked/${targetUid}`);
      const data: BlockedUser = { uid: targetUid, reason, blockedAt: Timestamp.fromDate(new Date()) };
      return setDoc(ref, data);
    }).pipe(
      tap(() => this.notifier.showInfo('Usuário bloqueado.')),
      map(() => void 0)
    );
  }

  /** Desbloquear usuário */
  unblockUser(ownerUid: string, targetUid: string) {
    this.dbg('unblockUser', { ownerUid, targetUid });
    return this.inCtx$(() => {
      const ref = doc(this.db, `users/${ownerUid}/blocked/${targetUid}`);
      return updateDoc(ref, { blockedAt: null });
    }).pipe(
      tap(() => this.notifier.showInfo('Usuário desbloqueado.')),
      map(() => void 0)
    );
  }

  listBlocked(uid: string) {
    return this.inCtx$(() => {
      const col = collection(this.db, `users/${uid}/blocked`);
      return getDocs(col);
    }).pipe(map(snap => snap.docs.map(d => d.data() as BlockedUser)));
  }
}
