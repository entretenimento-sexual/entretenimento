//src\app\core\services\interactions\friendship\friendship.service.ts
import { Injectable, inject } from '@angular/core';
import { switchMap, forkJoin, throwError, Observable } from 'rxjs';
import { environment } from 'src/environments/environment';
import { FriendshipRepo } from './friendship.repo';
import { Friend } from '../../../interfaces/friendship/friend.interface';
import { FriendRequest } from '../../../interfaces/friendship/friend-request.interface';
import { BlockedUserActive } from '../../../interfaces/friendship/blocked-user.interface';
import { IUserDados } from '../../../interfaces/iuser-dados';

@Injectable({ providedIn: 'root' })
export class FriendshipService {
  private repo = inject(FriendshipRepo);

  private dbg(msg: string, extra?: unknown) {
    if (!environment.production) console.log(`[FRIENDSHIP] ${msg}`, extra ?? '');
  }

  // =======================
  // Regras + delegação para o repo
  // =======================

  /** Enviar solicitação de amizade (valida amizade/bloqueios/duplicata) */
  sendRequest(requesterUid: string, targetUid: string, message?: string): Observable<void> {
    if (!requesterUid || !targetUid || requesterUid === targetUid) {
      return throwError(() => new Error('[FRIENDSHIP] requesterUid/targetUid inválidos'));
    }
    this.dbg('sendRequest: validating', { requesterUid, targetUid });

    return this.repo.isAlreadyFriends(requesterUid, targetUid).pipe(
      switchMap(friendSnap => {
        if (friendSnap.exists()) {
          return throwError(() => new Error('Vocês já são amigos.'));
        }
        // 👉 objeto em vez de array para tipagem estável
        return forkJoin({
          iBlockedSnap: this.repo.isBlockedByA(requesterUid, targetUid),
          blockedMeSnap: this.repo.isBlockedByA(targetUid, requesterUid),
        });
      }),
      switchMap(({ iBlockedSnap, blockedMeSnap }) => {
        if (iBlockedSnap.exists()) return throwError(() => new Error('Você bloqueou este usuário.'));
        if (blockedMeSnap.exists()) return throwError(() => new Error('Você foi bloqueado por este usuário.'));
        return this.repo.findDuplicatePending(requesterUid, targetUid);
      }),
      switchMap(snap => {
        if (!snap.empty) return throwError(() => new Error('Já existe uma solicitação pendente.'));
        return this.repo.createRequest(requesterUid, targetUid, message);
      })
    );
  }

  /** Minhas solicitações enviadas (pendentes) */
  listOutboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.repo.listOutboundRequests(uid);
  }

  /** Aceitar: amizade bilateral + status accepted */
  acceptRequest(requestId: string, requesterUid: string, targetUid: string): Observable<void> {
    this.dbg('acceptRequest', { requestId, requesterUid, targetUid });
    return this.repo.acceptRequestBatch(requestId, requesterUid, targetUid);
  }

  /** Recusar */
  declineRequest(requestId: string): Observable<void> {
    this.dbg('declineRequest', { requestId });
    return this.repo.declineRequest(requestId);
  }

  /** Recebidas (pendentes) */
  listInboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.repo.listInboundRequests(uid);
  }

  /** Amigos do usuário */
  listFriends(uid: string): Observable<Friend[]> {
    return this.repo.listFriends(uid);
  }

  /** Bloquear / Desbloquear / Listar bloqueados */
  blockUser(ownerUid: string, targetUid: string, reason?: string): Observable<void> {
    this.dbg('blockUser', { ownerUid, targetUid });
    return this.repo.blockUser(ownerUid, targetUid, reason);
  }
  unblockUser(ownerUid: string, targetUid: string): Observable<void> {
    this.dbg('unblockUser', { ownerUid, targetUid });
    return this.repo.unblockUser(ownerUid, targetUid);
  }
  listBlocked(uid: string): Observable<BlockedUserActive[]> {
    return this.repo.listBlocked(uid);
  }

  /** Cancelar enviada */
  cancelOutboundRequest(requestId: string): Observable<void> {
    this.dbg('cancelOutboundRequest', { requestId });
    return this.repo.cancelOutboundRequest(requestId);
  }

  /** Busca */
  searchUsers(term: string): Observable<IUserDados[]> {
    return this.repo.searchUsers(term);
  }

  /** Realtime */
  watchInboundRequests(uid: string) {
    return this.repo.watchInboundRequests(uid);
  }
  watchOutboundRequests(uid: string) {
    return this.repo.watchOutboundRequests(uid);
  }
}
