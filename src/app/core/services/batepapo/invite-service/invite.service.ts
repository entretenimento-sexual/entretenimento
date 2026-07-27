// src/app/core/services/batepapo/invite-service/invite.service.ts
// Serviço de criação e manutenção sender-side de convites.
// Respostas accepted/declined pertencem exclusivamente ao RoomInviteFlowService.
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Observable, defer, forkJoin, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { InviteDocId } from 'src/app/core/utils/invite-utils';
import { UserDiscoveryQueryService } from '../../data-handling/queries/user-discovery.query.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { DistanceCalculationService } from '../../geolocation/distance-calculation.service';

@Injectable({ providedIn: 'root' })
export class InviteService {
  constructor(
    private readonly db: Firestore,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly discoveryQuery: UserDiscoveryQueryService,
    private readonly distanceService: DistanceCalculationService
  ) {}

  private report(error: unknown, context: Record<string, unknown>): void {
    try {
      const wrapped = new Error('[InviteService] operação falhou');
      (wrapped as any).feature = 'invites';
      (wrapped as any).original = error;
      (wrapped as any).context = context;
      (wrapped as any).skipUserNotification = true;
      this.globalError.handleError(wrapped);
    } catch {
      // noop
    }
  }

  /** Cria/atualiza convite de sala com docId determinístico. */
  createInvite(inviteData: Invite): Observable<void> {
    return defer(() => {
      const type = inviteData.type ?? 'room';

      if (type !== 'room') {
        return throwError(
          () =>
            new Error(
              'InviteService.createInvite: type ainda não suportado neste fluxo.'
            )
        );
      }

      const targetId = String(
        inviteData.targetId || inviteData.roomId || ''
      ).trim();
      const receiverId = String(inviteData.receiverId || '').trim();

      if (!targetId || !receiverId) {
        return throwError(() => new Error('Dados inválidos para convite de sala.'));
      }

      const id = InviteDocId.room(targetId, receiverId);
      const inviteRef = doc(this.db as any, 'invites', id);
      const payload: Invite = {
        ...inviteData,
        type: 'room',
        targetId,
        targetName: inviteData.targetName ?? inviteData.roomName ?? '',
        roomId: targetId,
        roomName: inviteData.roomName ?? inviteData.targetName ?? '',
        updatedAt: serverTimestamp() as any,
      };

      return from(
        setDoc(inviteRef as any, payload as any, { merge: false })
      ).pipe(map(() => void 0));
    }).pipe(
      catchError((error) => {
        this.report(error, { op: 'createInvite' });
        this.errorNotifier.showError('Erro ao criar convite.');
        return throwError(() => error);
      })
    );
  }

  /** Compatibilidade genérica. Convites de sala são normalizados pelo owner. */
  sendInvite(invite: Invite): Observable<void> {
    if ((invite.type ?? 'room') === 'room') {
      return this.createInvite(invite);
    }

    const invitesCollection = collection(this.db, 'invites');

    return from(addDoc(invitesCollection, invite)).pipe(
      map(() => void 0),
      catchError((error) => {
        this.report(error, { op: 'sendInvite' });
        this.errorNotifier.showError('Erro ao enviar convite.');
        return throwError(() => error);
      })
    );
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
          this.errorNotifier.showError('Erro ao enviar convites.');
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
        this.errorNotifier.showError('Erro ao carregar convites.');
        return throwError(() => error);
      })
    );
  }

  /**
   * Método público preservado.
   * IDs aleatórios foram suprimidos; o fluxo delega ao createInvite canônico.
   */
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
    return defer(() => {
      const safeRoomId = String(roomId ?? '').trim();
      const receiverId = String(inviteData.receiverId ?? '').trim();
      const senderId = String(inviteData.senderId ?? '').trim();

      if (!safeRoomId) {
        return throwError(() => new Error('roomId ausente para convite.'));
      }

      if (!receiverId || !senderId) {
        return throwError(
          () => new Error('senderId/receiverId ausentes para convite.')
        );
      }

      return this.createInvite({
        ...inviteData,
        type: 'room',
        targetId: String(
          inviteData.targetId ?? inviteData.roomId ?? safeRoomId
        ).trim(),
        targetName: inviteData.targetName ?? inviteData.roomName ?? '',
        roomId: safeRoomId,
        roomName: inviteData.roomName ?? inviteData.targetName ?? '',
        status: inviteData.status ?? 'pending',
        sentAt: inviteData.sentAt ?? Timestamp.fromDate(new Date()),
        expiresAt:
          inviteData.expiresAt ??
          Timestamp.fromDate(
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          ),
      });
    }).pipe(
      catchError((error) => {
        this.report(error, { op: 'sendInviteToRoom', roomId });
        this.errorNotifier.showError('Erro ao enviar convite.');
        return throwError(() => error);
      })
    );
  }
}
