// src/app/core/services/data-handling/user-interactions.service.ts
import { Injectable } from '@angular/core';
import { DataSyncService } from '../general/cache/cache+store/data-sync.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { Observable, of, switchMap, take, tap, map } from 'rxjs';
import { IFriendRequest } from '../../interfaces/friendship/ifriend-request';
import { IBlockedUser, IFriend } from '../../interfaces/friendship/ifriend';
import { IUserDados } from '../../interfaces/iuser-dados';

@Injectable({
  providedIn: 'root'
})
export class UserInteractionsService {
  constructor(
    private dataSyncService: DataSyncService,
    private store: Store<AppState>
  ) { }

  /** 🔹 Retorna a lista de amigos de um usuário */
  listFriends(uid: string): Observable<IFriend[]> {
    if (!uid) {
      return of([]);
    }

    return this.dataSyncService.getData<IFriend[]>(
      `friends:${uid}`,
      state => Array.isArray(state.friends?.friends) ? state.friends.friends : [],
      `users/${uid}/friends`
    ).pipe(
      map(friends => Array.isArray(friends) ? friends.flat() : []),
      tap(friends => console.log(`✅ Amigos carregados:`, friends))
    );
  }

  /** 🔹 Envia uma solicitação de amizade */
  sendFriendRequest(uid: string, friendUid: string, message: string = ''): Observable<void> {
    if (!uid || !friendUid) {
      return of(void 0);
    }

    const requestData: IFriendRequest = {
      requesterUid: uid,
      recipientUid: friendUid,
      type: 'request',
      message,
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Expira em 30 dias
    };

    return this.dataSyncService.saveData<IFriendRequest>(
      `friend_requests:${friendUid}`,
      state => Array.isArray(state.friends?.requests) ? state.friends.requests : [],
      `users/${friendUid}/friendRequests`,
      uid,  // ✅ Passando `docId` corretamente
      requestData
    );
  }

  /** 🔹 Bloqueia um usuário */
  blockUser(uid: string, friendUid: string): Observable<void> {
    if (!uid || !friendUid) {
      return of(void 0);
    }

    const blockData: IBlockedUser = {
      blockerUid: uid,
      blockedUid: friendUid,
      timestamp: new Date()
    };

    return this.dataSyncService.saveData<IBlockedUser>(
      `blocked:${uid}`,
      state => Array.isArray(state.friends?.blocked) ? state.friends.blocked : [],
      `users/${uid}/blocked`,
      friendUid, // ✅ Passando `docId` corretamente
      blockData
    );
  }

  /** 🔹 Aceita uma solicitação de amizade */
  acceptFriendRequest(uid: string, friendUid: string): Observable<void> {
    if (!uid || !friendUid) {
      return of(void 0);
    }

    return this.dataSyncService.getData<IUserDados>(
      `users:${friendUid}`,
      state => {
        const userState = state.user as unknown;
        if (Array.isArray(userState)) {
          return userState.find((u: IUserDados) => u.uid === friendUid) ?? null;
        }
        return typeof userState === 'object' && userState !== null
          ? (userState as Record<string, IUserDados>)[friendUid] ?? null
          : null;
      },
      `users/${friendUid}`
    ).pipe(
      switchMap(friendDetails => {
        if (!friendDetails || Array.isArray(friendDetails)) {
          return of(void 0);
        }

        const friendData: IFriend = {
          friendUid,
          friendSince: new Date(),
          nickname: friendDetails.nickname ?? undefined,
          photoURL: friendDetails.photoURL ?? undefined,
          municipioEstado: friendDetails.municipio ? `${friendDetails.municipio} - ${friendDetails.estado ?? ''}` : undefined,
          gender: friendDetails.gender ?? undefined,
          idade: friendDetails.idade ?? undefined
        };

        return this.dataSyncService.saveData<IFriend>(
          `friends:${uid}`,
          state => Array.isArray(state.friends?.friends) ? state.friends.friends : [],
          `users/${uid}/friends`,
          friendUid,  // ✅ Passando `docId` corretamente
          friendData
        );
      })
    );
  }

  /** 🔹 Remove solicitações de amizade expiradas */
  cleanupExpiredRequests(uid: string): void {
    this.dataSyncService.getData<IFriendRequest[]>(
      `friend_requests:${uid}`,
      state => Array.isArray(state.friends?.requests) ? state.friends.requests : [],
      `users/${uid}/friendRequests`
    ).pipe(take(1)).subscribe(requests => {
      if (!requests.length) {
        return;
      }

      const expiredRequests = requests.filter(req =>
        req && !Array.isArray(req) && req.expiresAt && new Date(req.expiresAt) <= new Date()
      );

      expiredRequests.forEach(request => {
        if (request && typeof request === 'object' && 'recipientUid' in request) {
          this.dataSyncService.deleteDocument(`users/${uid}/friendRequests`, request.recipientUid).subscribe(); // ✅ Passando `docId`
        }
      });
    });
  }
}
