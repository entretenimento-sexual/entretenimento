//src\app\core\services\interactions\friendship\friendship.service.ts
// Não esquecer comentários e ferramentas de debug
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable } from 'rxjs';
import { environment } from 'src/environments/environment';
import { FriendshipRepo } from './friendship.repo';
import { Friend } from '../../../interfaces/friendship/friend.interface';
import { FriendRequest } from '../../../interfaces/friendship/friend-request.interface';
import { BlockedUserActive } from '../../../interfaces/friendship/blocked-user.interface';
import { IUserDados } from '../../../interfaces/iuser-dados';

interface SendFriendRequestCallablePayload {
  targetUid: string;
  message?: string;
}

interface SendFriendRequestCallableResponse {
  requestId: string;
  status: 'pending';
}

interface AcceptFriendRequestCallablePayload {
  requestId: string;
}

interface AcceptFriendRequestCallableResponse {
  requestId: string;
  requesterUid: string;
  targetUid: string;
  status: 'accepted';
}

@Injectable({ providedIn: 'root' })
export class FriendshipService {
  private repo = inject(FriendshipRepo);
private functions = inject(Functions);

private readonly sendFriendRequestCallable = httpsCallable<
  SendFriendRequestCallablePayload,
  SendFriendRequestCallableResponse
>(this.functions, 'sendFriendRequest');

private readonly acceptFriendRequestCallable = httpsCallable<
  AcceptFriendRequestCallablePayload,
  AcceptFriendRequestCallableResponse
>(this.functions, 'acceptFriendRequest');

  private dbg(msg: string, extra?: unknown) {
    if (!environment.production) console.log(`[FRIENDSHIP] ${msg}`, extra ?? '');
  }

  // =======================
  // Regras + delegação para o repo
  // =======================

  /** Enviar solicitação de amizade (valida amizade/bloqueios/duplicata) */
sendRequest(
  requesterUid: string,
  targetUid: string,
  message?: string
): Observable<void> {
  const safeTargetUid = String(targetUid ?? '').trim();
  const safeMessage = String(message ?? '').trim();

  if (!safeTargetUid) {
    return defer(() => {
      throw new Error('[FRIENDSHIP] targetUid inválido');
    });
  }

  this.dbg('sendRequest: callable', {
    requesterUid,
    targetUid: safeTargetUid,
  });

  return defer(() =>
    from(
      this.sendFriendRequestCallable({
        targetUid: safeTargetUid,
        ...(safeMessage ? { message: safeMessage } : {}),
      })
    )
  ).pipe(map(() => void 0));
}

  /** Minhas solicitações enviadas (pendentes) */
  listOutboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.repo.listOutboundRequests(uid);
  }

  /** Aceitar: amizade bilateral + status accepted */
acceptRequest(
  requestId: string,
  requesterUid: string,
  targetUid: string
): Observable<void> {
  const safeRequestId = String(requestId ?? '').trim();

  if (!safeRequestId) {
    return defer(() => {
      throw new Error('[FRIENDSHIP] requestId inválido');
    });
  }

  this.dbg('acceptRequest: callable', {
    requestId: safeRequestId,
    requesterUid,
    targetUid,
  });

  return defer(() =>
    from(
      this.acceptFriendRequestCallable({
        requestId: safeRequestId,
      })
    )
  ).pipe(map(() => void 0));
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

  listFriendsPage(uid: string, pageSize = 24, after: number | null = null) {
    return this.repo.listFriendsPage(uid, pageSize, after);
  }
} //115 linhas
