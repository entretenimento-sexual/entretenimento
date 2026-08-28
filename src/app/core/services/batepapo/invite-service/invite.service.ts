// src/app/core/services/batepapo/invite-service/invite.service.ts
// Serviço de criação e manutenção sender-side de convites de sala.
// Respostas accepted/declined pertencem exclusivamente ao RoomInviteFlowService.
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Observable, defer, forkJoin, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserDiscoveryQueryService } from '../../data-handling/queries/user-discovery.query.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { DistanceCalculationService } from '../../geolocation/distance-calculation.service';

interface SendRoomInviteCallablePayload {
  roomId: string;
  receiverId: string;
}

interface SendRoomInviteCallableResponse {
  inviteId: string;
  roomId: string;
  receiverId: string;
  status: 'pending';
  deduplicated: boolean;
}

@Injectable({ providedIn: 'root' })
export class InviteService {
  private readonly sendRoomInviteCallable: ReturnType<
    typeof httpsCallable<
      SendRoomInviteCallablePayload,
      SendRoomInviteCallableResponse
    >
  >;

  constructor(
    private readonly db: Firestore,
    functions: Functions,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly discoveryQuery: UserDiscoveryQueryService,
    private readonly distanceService: DistanceCalculationService
  ) {
    this.sendRoomInviteCallable = httpsCallable<
      SendRoomInviteCallablePayload,
      SendRoomInviteCallableResponse
    >(functions, 'sendRoomInvite');
  }

  private report(error: unknown, context: Record<string, unknown>): void {
    try {
      const wrapped = new Error('[InviteService] operação falhou');
      (wrapped as any).feature = 'room-invites';
      (wrapped as any).original = error;
      (wrapped as any).context = context;
      (wrapped as any).skipUserNotification = true;
      this.globalError.handleError(wrapped);
    } catch {
      // noop
    }
  }

  /**
   * Cria ou deduplica convite de sala pela autoridade backend.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - removido setDoc direto em /invites;
   * - senderId, nome da sala, timestamps e validade enviados pelo cliente são
   *   ignorados como autoridade;
   * - a callable deriva e valida esses campos no backend.
   *
   * O nome público é preservado para não quebrar os consumidores existentes.
   */
  createInvite(inviteData: Invite): Observable<void> {
    const rawType = inviteData?.type ?? 'room';
    const rawRoomId = inviteData?.targetId ?? inviteData?.roomId;
    const rawReceiverId = inviteData?.receiverId;

    return defer(() => {
      if (rawType !== 'room') {
        throw new Error(
          'InviteService.createInvite: somente convites de sala pertencem a este fluxo.'
        );
      }

      const roomId = this.requireCanonicalPart(
        rawRoomId,
        'Sala inválida para convite.'
      );
      const receiverId = this.requireCanonicalPart(
        rawReceiverId,
        'Destinatário inválido para convite.'
      );

      return from(
        this.sendRoomInviteCallable({ roomId, receiverId })
      ).pipe(
        map((response) => {
          this.assertValidSendResponse(response.data, roomId, receiverId);
          return void 0;
        })
      );
    }).pipe(
      catchError((error) => {
        this.report(error, {
          op: 'createInvite',
          roomId: String(rawRoomId ?? '').trim(),
          receiverId: String(rawReceiverId ?? '').trim(),
        });
        this.errorNotifier.showError(
          this.toUserMessage(error, 'Não foi possível enviar o convite para a sala.')
        );
        return throwError(() => error);
      })
    );
  }

  /**
   * Compatibilidade genérica preservada.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - removido addDoc genérico para community/friend;
   * - esses domínios devem usar contratos e callables próprios;
   * - isso impede que um tipo não suportado apareça no inbox de salas.
   */
  sendInvite(invite: Invite): Observable<void> {
    if ((invite?.type ?? 'room') === 'room') {
      return this.createInvite(invite);
    }

    const error = new Error(
      'Este tipo de convite ainda não possui um fluxo próprio implementado.'
    );
    this.report(error, { op: 'sendInvite', type: invite?.type ?? null });
    this.errorNotifier.showError(
      'Este tipo de convite ainda não está disponível.'
    );
    return throwError(() => error);
  }

  sendInvitesToNearbyUsers(
    roomId: string,
    roomName: string,
    inviter: IUserDados,
    maxDistanceKm = 50
  ): Observable<void> {
    if (!inviter?.uid || !inviter.latitude || !inviter.longitude) {
      this.errorNotifier.showError('Dados do convidante inválidos.');
      return throwError(() => new Error('Dados do convidante inválidos.'));
    }

    return this.discoveryQuery
      .searchUsers([
        where('latitude', '>', 0),
        where('longitude', '>', 0),
      ])
      .pipe(
        map((users) =>
          users.filter((user) => {
            if (!user?.uid || !user.latitude || !user.longitude) {
              return false;
            }

            const distance = this.distanceService.calculateDistanceInKm(
              inviter.latitude!,
              inviter.longitude!,
              user.latitude!,
              user.longitude!,
              maxDistanceKm
            );

            return user.uid !== inviter.uid && distance !== null;
          })
        ),
        switchMap((nearbyUsers) => {
          if (!nearbyUsers.length) return of(void 0);

          const sentAt = Timestamp.fromDate(new Date());
          const expiresAt = Timestamp.fromDate(
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          );

          return forkJoin(
            nearbyUsers.map((user) =>
              this.createInvite({
                type: 'room',
                targetId: roomId,
                targetName: roomName,
                roomId,
                roomName,
                receiverId: user.uid,
                senderId: inviter.uid,
                status: 'pending',
                sentAt,
                expiresAt,
              })
            )
          ).pipe(map(() => void 0));
        }),
        catchError((error) => {
          this.report(error, { op: 'sendInvitesToNearbyUsers', roomId });
          this.errorNotifier.showError('Erro ao enviar convites para a sala.');
          return throwError(() => error);
        })
      );
  }

  /**
   * Método público preservado para compatibilidade sender-side.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - `accepted` e `declined` não fazem mais updateDoc no navegador;
   * - use RoomInviteFlowService, que chama a autoridade backend;
   * - `expired` e `canceled` continuam sujeitos às Rules do sender.
   */
  updateInviteStatus(
    inviteId: string,
    status: 'accepted' | 'declined' | 'expired' | 'canceled'
  ): Observable<void> {
    const safeInviteId = String(inviteId ?? '').trim();

    return defer(() => {
      if (!safeInviteId) {
        return throwError(() => new Error('inviteId inválido.'));
      }

      if (status === 'accepted' || status === 'declined') {
        return throwError(
          () =>
            new Error(
              'Resposta a convite deve usar RoomInviteFlowService/Cloud Functions.'
            )
        );
      }

      return from(
        updateDoc(doc(this.db, `invites/${safeInviteId}`), {
          status,
          updatedAt: serverTimestamp(),
        })
      ).pipe(map(() => void 0));
    }).pipe(
      catchError((error) => {
        this.report(error, {
          op: 'updateInviteStatus',
          inviteId: safeInviteId,
          status,
        });
        this.errorNotifier.showError(
          status === 'accepted' || status === 'declined'
            ? 'Use o fluxo seguro para responder ao convite.'
            : 'Erro ao atualizar status do convite.'
        );
        return throwError(() => error);
      })
    );
  }

  getInvites(userId: string): Observable<Invite[]> {
    const invitesQuery = query(
      collection(this.db, 'invites'),
      where('receiverId', '==', userId)
    );

    return from(getDocs(invitesQuery)).pipe(
      map((snapshot) =>
        snapshot.docs.map((item) => ({
          id: item.id,
          ...(item.data() as Invite),
        }))
      ),
      catchError((error) => {
        this.report(error, { op: 'getInvites', userId });
        this.errorNotifier.showError('Erro ao carregar convites para salas.');
        return throwError(() => error);
      })
    );
  }

  /** Método público preservado; delega ao envio canônico backend-only. */
  sendInviteWithTransaction(invite: Invite): Observable<void> {
    return this.createInvite(invite);
  }

  updateExpiredInvites(): Observable<void> {
    const pendingExpiredQuery = query(
      collection(this.db, 'invites'),
      where('status', '==', 'pending'),
      where('expiresAt', '<=', Timestamp.fromDate(new Date()))
    );

    return from(getDocs(pendingExpiredQuery)).pipe(
      switchMap((snapshot) =>
        forkJoin(
          snapshot.docs.map((item) =>
            updateDoc(item.ref, {
              status: 'expired',
              updatedAt: serverTimestamp(),
            })
          )
        )
      ),
      map(() => void 0),
      catchError((error) => {
        this.report(error, { op: 'updateExpiredInvites' });
        return throwError(() => error);
      })
    );
  }

  deleteExpiredInvites(): Observable<void> {
    const expiredQuery = query(
      collection(this.db, 'invites'),
      where('status', '==', 'expired')
    );

    return from(getDocs(expiredQuery)).pipe(
      switchMap((snapshot) =>
        forkJoin(snapshot.docs.map((item) => deleteDoc(item.ref)))
      ),
      map(() => void 0),
      catchError((error) => {
        this.report(error, { op: 'deleteExpiredInvites' });
        return throwError(() => error);
      })
    );
  }

  /** API compatível com o ChatListComponent. */
  sendInviteToRoom(roomId: string, inviteData: Invite): Observable<void> {
    const safeRoomId = String(roomId ?? '').trim();

    return this.createInvite({
      ...inviteData,
      type: 'room',
      targetId: String(
        inviteData?.targetId ?? inviteData?.roomId ?? safeRoomId
      ).trim(),
      roomId: safeRoomId,
    });
  }

  private requireCanonicalPart(value: unknown, message: string): string {
    const normalized = String(value ?? '').trim();

    if (!normalized || normalized.length > 160 || normalized.includes(':')) {
      throw new Error(message);
    }

    return normalized;
  }

  private assertValidSendResponse(
    result: SendRoomInviteCallableResponse | null | undefined,
    roomId: string,
    receiverId: string
  ): void {
    const expectedInviteId = `room:${roomId}:to:${receiverId}`;

    if (
      !result ||
      result.status !== 'pending' ||
      String(result.roomId ?? '').trim() !== roomId ||
      String(result.receiverId ?? '').trim() !== receiverId ||
      String(result.inviteId ?? '').trim() !== expectedInviteId
    ) {
      throw new Error('Resposta inválida ao enviar convite para sala.');
    }
  }

  private toUserMessage(error: unknown, fallback: string): string {
    const raw = String(
      (error as { message?: unknown } | null)?.message ?? ''
    ).trim();

    return raw || fallback;
  }
}
