// src/app/core/services/data-handling/user-interactions.service.ts
// DEPRECATED: use FriendshipService instead, which uses DataSyncService internally.
// DEPRECATED: use FriendshipService instead, which uses DataSyncService internally.
// DEPRECATED: use FriendshipService instead, which uses DataSyncService internally.
import { Injectable } from '@angular/core';
import { DataSyncService } from '../general/cache/cache+store/data-sync.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { Observable, of, switchMap, take, tap, map } from 'rxjs';

import { IUserDados } from '../../interfaces/iuser-dados';
import { Friend } from '../../interfaces/friendship/friend.interface';
import { FriendRequest } from '../../interfaces/friendship/friend-request.interface';
import { BlockedUser } from '../../interfaces/friendship/blocked-user.interface';

import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';
import { Timestamp } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class UserInteractionsService {
  constructor(
    private dataSync: DataSyncService,
    private store: Store<AppState>,
    private notify: ErrorNotificationService
  ) { }

  /** Garante que o valor é um IUserDados */
  private isUserDados = (x: unknown): x is IUserDados =>
    !!x && typeof x === 'object' && 'uid' in (x as any);

  /** 🔹 Lista de amigos de um usuário */
  listFriends(uid: string): Observable<Friend[]> {
    if (!uid) return of([]);

    return this.dataSync
      .getData<Friend[]>(
        `friends:${uid}`,
        state => (Array.isArray(state.friends?.friends) ? state.friends.friends : []),
        `users/${uid}/friends`
      )
      .pipe(
        map(friends => (Array.isArray(friends) ? friends.flat() : [])),
        tap(friends => console.debug('[Friendship] Amigos carregados:', friends))
      );
  }

  /** 🔹 Envia solicitação de amizade (doc em: users/{targetUid}/friendRequests/{requesterUid}) */
  sendFriendRequest(uid: string, friendUid: string, message: string = ''): Observable<void> {
    if (!uid || !friendUid || uid === friendUid) return of(void 0);

    const requestData: FriendRequest = {
      requesterUid: uid,
      targetUid: friendUid,
      message,
      status: 'pending',
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30d
    };

    // cacheKey e selector seguem seu padrão de DataSyncService
    return this.dataSync
      .saveData<FriendRequest>(
        `friend_requests:${friendUid}`,
        state => (Array.isArray(state.friends?.requests) ? state.friends.requests : []),
        `users/${friendUid}/friendRequests`,
        uid, // docId = requesterUid
        requestData
      )
      .pipe(
        tap(() => {
          console.debug('[Friendship] Solicitação enviada:', requestData);
          this.notify.showSuccess('Solicitação de amizade enviada.');
        })
      );
  }

  /** 🔹 Bloquear usuário (doc: users/{ownerUid}/blocked/{targetUid}) */
  blockUser(uid: string, friendUid: string, reason?: string): Observable<void> {
    if (!uid || !friendUid) return of(void 0);

    const blockData: BlockedUser = {
      uid: friendUid,
      reason,
      blockedAt: Timestamp.now(),
    };

    return this.dataSync
      .saveData<BlockedUser>(
        `blocked:${uid}`,
        state => (Array.isArray(state.friends?.blocked) ? state.friends.blocked : []),
        `users/${uid}/blocked`,
        friendUid, // docId
        blockData
      )
      .pipe(
        tap(() => {
          console.debug('[Friendship] Usuário bloqueado:', blockData);
          this.notify.showInfo('Usuário bloqueado.');
        })
      );
  }

  acceptFriendRequest(myUid: string, friendUid: string): Observable<void> {
    if (!myUid || !friendUid) return of(void 0);

    return this.dataSync
      // 👇 aceite que pode vir array e trate abaixo
      .getData<IUserDados | (IUserDados | null)[]>(
        `users:${friendUid}`,
        (state) => {
          const userState: unknown = (state as any).user;

          if (Array.isArray(userState)) {
            // quando o estado for array, tente localizar o usuário
            const found = (userState as (IUserDados | null)[]).find(
              (u): u is IUserDados => this.isUserDados(u) && u.uid === friendUid
            );
            return found ? [found] : [];
          }

          if (userState && typeof userState === 'object') {
            const byId = (userState as Record<string, IUserDados>)[friendUid];
            return byId ? [byId] : [];
          }

          return [];
        },
        `users/${friendUid}`
      )
      .pipe(
        switchMap((raw) => {
          // 🔎 Narrow final: se vier array, extraia um único objeto; se vier objeto, valide
          const friendDetails: IUserDados | null = Array.isArray(raw)
            ? raw.find((u): u is IUserDados => this.isUserDados(u) && u.uid === friendUid) ?? null
            : (this.isUserDados(raw) ? raw : null);

          const nowTs = Timestamp.now();

          const friendData: Friend = {
            friendUid,
            since: nowTs,
            lastInteractionAt: nowTs,
            nickname: friendDetails?.nickname ?? undefined, // ✅ agora o TS aceita
          };

          return this.dataSync.saveData<Friend>(
            `friends:${myUid}`,
            state => (Array.isArray(state.friends?.friends) ? state.friends.friends : []),
            `users/${myUid}/friends`,
            friendUid,
            friendData
          );
        }),
        tap(() => {
          console.debug('[Friendship] Solicitação aceita. Novo amigo:', { myUid, friendUid });
          this.notify.showSuccess('Agora vocês são amigos!');
        })
      );
  }

  /** 🔹 Rejeita solicitação (remove o doc da subcoleção inbound) */
  rejectFriendRequest(myUid: string, requesterUid: string): Observable<void> {
    if (!myUid || !requesterUid) return of(void 0);

    return this.dataSync
      .deleteDocument(`users/${myUid}/friendRequests`, requesterUid)
      .pipe(
        tap(() => {
          console.debug('[Friendship] Solicitação rejeitada:', { myUid, requesterUid });
          this.notify.showInfo('Solicitação rejeitada.');
        })
      );
  }

  /** 🔎 Busca de usuários (stub) */
  findUsersBySearchTerm(term: string): Observable<IUserDados[]> {
    const q = (term ?? '').trim();
    if (!q) return of([]);
    // TODO: integrar query real no Firestore / index
    return of([]);
  }

  /** 🔹 Limpa solicitações expiradas na inbox do usuário (users/{uid}/friendRequests) */
  cleanupExpiredRequests(uid: string): void {
    this.dataSync
      // 👇 Force a retornar lista (ou null)
      .getData<FriendRequest[] | null>(
        `friend_requests:${uid}`,
        state => (Array.isArray(state.friends?.requests) ? state.friends.requests : []),
        `users/${uid}/friendRequests`
      )
      .pipe(take(1))
      .subscribe((requests) => {
        // 👇 Garanta array tipado de FriendRequest
        const list: FriendRequest[] = Array.isArray(requests) ? requests as FriendRequest[] : [];
        if (!list.length) return;

        const now = Date.now();

        // ✅ Acesse expiresAt com segurança (Timestamp | undefined)
        const expired = list.filter(r => !!r?.expiresAt && r.expiresAt!.toMillis() <= now);

        for (const req of expired) {
          // inbound: docId = requesterUid
          if (req.requesterUid) {
            this.dataSync
              .deleteDocument(`users/${uid}/friendRequests`, req.requesterUid)
              .subscribe(() =>
                console.debug('[Friendship] Solicitação expirada removida:', req.requesterUid)
              );
          }
        }
      });
  }
}
