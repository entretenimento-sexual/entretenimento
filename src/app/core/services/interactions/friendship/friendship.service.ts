// src/app/core/services/interactions/friendship/friendship.service.ts
// -----------------------------------------------------------------------------
// FRIENDSHIP SERVICE
// -----------------------------------------------------------------------------
// Fachada Angular para ações sociais de amizade/conexão.
//
// Modelo de segurança:
//
// 1. Ações sociais sensíveis passam por Cloud Functions:
//    - enviar solicitação;
//    - aceitar solicitação;
//    - cancelar solicitação enviada;
//    - recusar solicitação recebida;
//    - desfazer amizade.
//
// 2. O cliente Angular não é autoridade:
//    - ele não cria amizade diretamente;
//    - ele não altera status de solicitação diretamente;
//    - ele não decide se pode conversar;
//    - ele apenas solicita ações ao backend.
//
// 3. O backend valida:
//    - request.auth.uid;
//    - e-mail verificado;
//    - ownership da solicitação;
//    - estado pending/accepted/etc.;
//    - bloqueios, lifecycle e amizade bilateral.
//
// 4. Mantemos Observable:
//    - padrão do projeto;
//    - compatível com effects NgRx;
//    - compatível com tratamento centralizado de erro.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable } from 'rxjs';

import { environment } from 'src/environments/environment';

import { FriendshipRepo } from './friendship.repo';
import { Friend } from '../../../interfaces/friendship/friend.interface';
import { FriendRequest } from '../../../interfaces/friendship/friend-request.interface';
import { BlockedUserActive } from '../../../interfaces/friendship/blocked-user.interface';
import { IUserDados } from '../../../interfaces/iuser-dados';

/* ============================================================================
 * Callable contracts
 * ============================================================================
 * Estes contratos ficam no frontend apenas para tipagem.
 * A validação real continua nas Cloud Functions.
 */

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

interface CancelFriendRequestCallablePayload {
  requestId: string;
}

interface CancelFriendRequestCallableResponse {
  requestId: string;
  requesterUid: string;
  targetUid: string;
  status: 'canceled';
}

interface DeclineFriendRequestCallablePayload {
  requestId: string;
}

interface DeclineFriendRequestCallableResponse {
  requestId: string;
  requesterUid: string;
  targetUid: string;
  status: 'declined';
}

interface EndFriendshipCallablePayload {
  friendUid: string;
}

interface EndFriendshipCallableResponse {
  actorUid: string;
  friendUid: string;
  status: 'ended';
}

@Injectable({ providedIn: 'root' })
export class FriendshipService {
  private readonly repo = inject(FriendshipRepo);
  private readonly functions = inject(Functions);

  private readonly sendFriendRequestCallable = httpsCallable<
    SendFriendRequestCallablePayload,
    SendFriendRequestCallableResponse
  >(this.functions, 'sendFriendRequest');

  private readonly acceptFriendRequestCallable = httpsCallable<
    AcceptFriendRequestCallablePayload,
    AcceptFriendRequestCallableResponse
  >(this.functions, 'acceptFriendRequest');

  private readonly cancelFriendRequestCallable = httpsCallable<
    CancelFriendRequestCallablePayload,
    CancelFriendRequestCallableResponse
  >(this.functions, 'cancelFriendRequest');

  private readonly declineFriendRequestCallable = httpsCallable<
    DeclineFriendRequestCallablePayload,
    DeclineFriendRequestCallableResponse
  >(this.functions, 'declineFriendRequest');

  private readonly endFriendshipCallable = httpsCallable<
    EndFriendshipCallablePayload,
    EndFriendshipCallableResponse
  >(this.functions, 'endFriendship');

  private dbg(msg: string, extra?: unknown): void {
    if (!environment.production) {
      console.log(`[FRIENDSHIP] ${msg}`, extra ?? '');
    }
  }

  /* ==========================================================================
   * Solicitações de amizade
   * ========================================================================== */

  /**
   * Envia solicitação de amizade via Cloud Function.
   *
   * Observação:
   * - requesterUid é mantido na assinatura por compatibilidade com chamadas
   *   existentes, mas a Function usa exclusivamente request.auth.uid.
   * - isso impede o cliente de enviar solicitação fingindo ser outro usuário.
   */
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

  /**
   * Aceita solicitação recebida via Cloud Function.
   *
   * Segurança:
   * - requesterUid e targetUid permanecem na assinatura por compatibilidade;
   * - a Function valida o requestId e identifica requester/target no backend;
   * - somente o target real pode aceitar.
   */
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

  /**
   * Cancela solicitação enviada via Cloud Function.
   *
   * Segurança:
   * - substitui o antigo delete/update client-side;
   * - somente quem enviou a solicitação pode cancelar;
   * - somente solicitação pending pode ser cancelada;
   * - backend preserva auditoria.
   */
  cancelOutboundRequest(requestId: string): Observable<void> {
    const safeRequestId = String(requestId ?? '').trim();

    if (!safeRequestId) {
      return defer(() => {
        throw new Error('[FRIENDSHIP] requestId inválido');
      });
    }

    this.dbg('cancelOutboundRequest: callable', {
      requestId: safeRequestId,
    });

    return defer(() =>
      from(
        this.cancelFriendRequestCallable({
          requestId: safeRequestId,
        })
      )
    ).pipe(map(() => void 0));
  }

  /**
   * Recusa solicitação recebida via Cloud Function.
   *
   * Segurança:
   * - substitui o antigo updateDoc client-side;
   * - somente o destinatário real pode recusar;
   * - recusar não equivale a bloquear;
   * - bloqueio deve continuar sendo uma ação separada.
   */
  declineRequest(requestId: string): Observable<void> {
    const safeRequestId = String(requestId ?? '').trim();

    if (!safeRequestId) {
      return defer(() => {
        throw new Error('[FRIENDSHIP] requestId inválido');
      });
    }

    this.dbg('declineRequest: callable', {
      requestId: safeRequestId,
    });

    return defer(() =>
      from(
        this.declineFriendRequestCallable({
          requestId: safeRequestId,
        })
      )
    ).pipe(map(() => void 0));
  }

  /**
   * Solicitações enviadas pendentes.
   *
   * Leitura continua pelo Firestore porque as Rules permitem somente envolvidos.
   * Escrita social sensível é que migrou para Functions.
   */
  listOutboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.repo.listOutboundRequests(uid);
  }

  /**
   * Solicitações recebidas pendentes.
   */
  listInboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.repo.listInboundRequests(uid);
  }

  /**
   * Realtime de solicitações recebidas.
   */
  watchInboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.repo.watchInboundRequests(uid);
  }

  /**
   * Realtime de solicitações enviadas.
   */
  watchOutboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.repo.watchOutboundRequests(uid);
  }

  /* ==========================================================================
   * Amigos
   * ========================================================================== */

  /**
   * Lista amigos do usuário.
   */
  listFriends(uid: string): Observable<Friend[]> {
    return this.repo.listFriends(uid);
  }

  /**
   * Observa amigos do usuário em tempo real.
   */
  watchFriends(uid: string): Observable<Friend[]> {
    return this.repo.watchFriends(uid);
  }

  /**
   * Lista paginada de amigos.
   */
  listFriendsPage(uid: string, pageSize = 24, after: number | null = null) {
    return this.repo.listFriendsPage(uid, pageSize, after);
  }

  /**
   * Desfaz amizade via Cloud Function.
   *
   * Segurança:
   * - remove as duas arestas no backend;
   * - mantém histórico de chat;
   * - bloqueia nova mensagem porque sendDirectMessage exige amizade bilateral.
   */
  endFriendship(ownerUid: string, friendUid: string): Observable<void> {
    const safeFriendUid = String(friendUid ?? '').trim();

    if (!safeFriendUid) {
      return defer(() => {
        throw new Error('[FRIENDSHIP] friendUid inválido');
      });
    }

    this.dbg('endFriendship: callable', {
      ownerUid,
      friendUid: safeFriendUid,
    });

    return defer(() =>
      from(
        this.endFriendshipCallable({
          friendUid: safeFriendUid,
        })
      )
    ).pipe(map(() => void 0));
  }

  /* ==========================================================================
   * Bloqueios e busca
   * ==========================================================================
   * Estes fluxos ainda permanecem no repo.
   * Em uma etapa futura, bloqueio/desbloqueio também deve migrar para callable,
   * porque bloqueio é uma ação de segurança e privacidade forte.
   */

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

  searchUsers(term: string): Observable<IUserDados[]> {
    return this.repo.searchUsers(term);
  }
}
/* segurança é uma prepcucação muito forte do projeto, mas preciso que sigamos mais convictamente 
do que implantar de segurança, mais passo a passo e mais explicadamente, 
além de seguirmos mais o modelo das grandes plataformas, 
e acho que contamos com a segurança oferecida pelo google firebase e angular. 
quero compreender o modelo de segurança e uma plataforma com aspecto, 
visual e modelo profissional que um usuário possa desfrutar para suas aventuras amorosas 
e sexuais de forma assertiva, discreta e sem risco de comprometimento */