// src/app/core/services/batepapo/invite-service/invite.service.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
//
// Ajustes desta versão:
// - remove dependência de FirestoreQueryService para discovery de usuários
// - usa UserDiscoveryQueryService (fonte pública / public_profiles)
// - mantém createInvite() com docId determinístico
// - mantém compat com sendInviteToRoom()
// - preserva Observable em toda a API
//
// Observação importante:
// - este ajuste NÃO resolve o erro de índice composto em /invites
// - o índice pedido pelo Firestore ainda precisa ser criado no console

import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  runTransaction,
  updateDoc,
  addDoc,
  Timestamp,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { Observable, from, throwError, forkJoin, defer, of } from 'rxjs';
import { map, catchError, switchMap, tap } from 'rxjs/operators';

import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { DistanceCalculationService } from '../../geolocation/distance-calculation.service';
import { InviteDocId } from 'src/app/core/utils/invite-utils';
import { UserDiscoveryQueryService } from '../../data-handling/queries/user-discovery.query.service';

@Injectable({ providedIn: 'root' })
export class InviteService {
  constructor(
    private db: Firestore,
    private errorNotifier: ErrorNotificationService,
    private globalError: GlobalErrorHandlerService,
    private discoveryQuery: UserDiscoveryQueryService,
    private distanceService: DistanceCalculationService
  ) {}

  private report(err: unknown, context: Record<string, unknown>): void {
    try {
      const e = new Error('[InviteService] operação falhou');
      (e as any).feature = 'invites';
      (e as any).original = err;
      (e as any).context = context;
      (e as any).skipUserNotification = true;
      this.globalError.handleError(e);
    } catch {
      // noop
    }
  }

  /** ✅ RECOMENDADO: cria/atualiza por docId determinístico (anti-duplicação) */
  createInvite(inviteData: Invite): Observable<void> {
    return defer(() => {
      const type = inviteData.type ?? 'room';

      if (type !== 'room') {
        return throwError(() =>
          new Error('InviteService.createInvite: type ainda não suportado neste fluxo.')
        );
      }

      const targetId = (inviteData.targetId || inviteData.roomId || '').trim();
      const receiverId = (inviteData.receiverId || '').trim();

      if (!targetId || !receiverId) {
        return throwError(() => new Error('Dados inválidos para convite de sala.'));
      }

      const id = InviteDocId.room(targetId, receiverId);
      const ref = doc(this.db as any, 'invites', id);

      const payload: Invite = {
        ...inviteData,

        type: 'room',
        targetId,
        targetName: inviteData.targetName ?? inviteData.roomName ?? '',

        // legacy (compat)
        roomId: targetId,
        roomName: inviteData.roomName ?? inviteData.targetName ?? '',

        updatedAt: serverTimestamp() as any,
      };

      return from(setDoc(ref as any, payload as any, { merge: false })).pipe(
        map(() => void 0)
      );
    }).pipe(
      catchError((err) => {
        this.report(err, { op: 'createInvite' });
        this.errorNotifier.showError('Erro ao criar convite.');
        return throwError(() => err);
      })
    );
  }

  /** Mantive, mas para ROOM prefira createInvite() */
  sendInvite(invite: Invite): Observable<void> {
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

  /**
   * Envia convites para usuários próximos com base em discovery público.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - removido FirestoreQueryService.searchUsers(...)
   *
   * Motivo:
   * - este fluxo deve usar UserDiscoveryQueryService
   * - assim a busca respeita a separação público/privado do projeto
   */
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

    return this.discoveryQuery.searchUsers([
      where('latitude', '>', 0),
      where('longitude', '>', 0),
    ]).pipe(
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
        if (!nearbyUsers.length) {
          return of(void 0);
        }

        const now = Timestamp.fromDate(new Date());
        const expires = Timestamp.fromDate(
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        );

        const tasks = nearbyUsers.map((user) =>
          this.createInvite({
            type: 'room',
            targetId: roomId,
            targetName: roomName,

            // legacy
            roomId,
            roomName,

            receiverId: user.uid,
            senderId: inviter.uid,
            status: 'pending',
            sentAt: now,
            expiresAt: expires,
          })
        );

        return forkJoin(tasks).pipe(map(() => void 0));
      }),
      tap(() => console.log('Convites enviados com sucesso.')),
      catchError((error) => {
        this.report(error, { op: 'sendInvitesToNearbyUsers', roomId });
        this.errorNotifier.showError('Erro ao enviar convites.');
        return throwError(() => error);
      })
    );
  }

  /** ✅ responder convite (rules exigem respondedAt/updatedAt) */
  updateInviteStatus(
    inviteId: string,
    status: 'accepted' | 'declined' | 'expired' | 'canceled'
  ): Observable<void> {
    const inviteRef = doc(this.db, `invites/${inviteId}`);
    const patch: any = {
      status,
      updatedAt: serverTimestamp(),
    };

    if (status === 'accepted' || status === 'declined') {
      patch.respondedAt = serverTimestamp();
    }

    return from(updateDoc(inviteRef, patch)).pipe(
      map(() => void 0),
      catchError((error) => {
        this.report(error, { op: 'updateInviteStatus', inviteId, status });
        this.errorNotifier.showError('Erro ao atualizar status do convite.');
        return throwError(() => error);
      })
    );
  }

  /** inbox simples (sem realtime). Se quiser realtime, faço no InviteSearchService. */
  getInvites(userId: string): Observable<Invite[]> {
    const invitesQuery = query(
      collection(this.db, 'invites'),
      where('receiverId', '==', userId)
    );

    return from(getDocs(invitesQuery)).pipe(
      map((snapshot) =>
        snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Invite) }))
      ),
      catchError((error) => {
        this.report(error, { op: 'getInvites', userId });
        this.errorNotifier.showError('Erro ao carregar convites.');
        return throwError(() => error);
      })
    );
  }

  sendInviteWithTransaction(invite: Invite): Observable<void> {
    return from(
      runTransaction(this.db, async (transaction) => {
        const inviteRef = doc(collection(this.db, 'invites'));
        const existing = query(
          collection(this.db, 'invites'),
          where('receiverId', '==', invite.receiverId),
          where('roomId', '==', invite.roomId)
        );
        const snap = await getDocs(existing);
        if (!snap.empty) throw new Error('Convite já existente.');
        transaction.set(inviteRef, invite);
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.errorNotifier.showError('Erro ao enviar convite.');
        return throwError(() => error);
      })
    );
  }

  updateExpiredInvites(): Observable<void> {
    const now = Timestamp.fromDate(new Date());
    const invitesCol = collection(this.db, 'invites');
    const q = query(
      invitesCol,
      where('status', '==', 'pending'),
      where('expiresAt', '<=', now)
    );

    return from(getDocs(q)).pipe(
      switchMap((snapshot) =>
        forkJoin(snapshot.docs.map((d) => updateDoc(d.ref, { status: 'expired' })))
      ),
      map(() => void 0),
      catchError((error) => {
        console.log('Erro ao atualizar convites expirados:', error);
        return throwError(() => error);
      })
    );
  }

  deleteExpiredInvites(): Observable<void> {
    const invitesCol = collection(this.db, 'invites');
    const q = query(invitesCol, where('status', '==', 'expired'));

    return from(getDocs(q)).pipe(
      switchMap((snapshot) =>
        forkJoin(snapshot.docs.map((d) => deleteDoc(d.ref)))
      ),
      map(() => void 0),
      catchError((error) => {
        console.log('Erro ao remover convites expirados:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * ✅ Mantém compat com o ChatListComponent (nomenclatura existente)
   * Recomendado: gravar SEMPRE em /invites (coleção raiz) via createInvite() (docId determinístico).
   */
  sendInviteToRoom(roomId: string, inviteData: Invite): Observable<void> {
    return defer(() => {
      const rid = (roomId ?? '').trim();
      if (!rid) {
        return throwError(() => new Error('roomId ausente para convite.'));
      }

      const receiverId = (inviteData.receiverId ?? '').trim();
      const senderId = (inviteData.senderId ?? '').trim();

      if (!receiverId || !senderId) {
        return throwError(() =>
          new Error('senderId/receiverId ausentes para convite.')
        );
      }

      const payload: Invite = {
        ...inviteData,

        // v2 (preferencial)
        type: 'room',
        targetId: (inviteData.targetId ?? inviteData.roomId ?? rid).trim(),
        targetName: inviteData.targetName ?? inviteData.roomName ?? '',

        // legacy (compat)
        roomId: rid,
        roomName: inviteData.roomName ?? inviteData.targetName ?? '',

        // defaults defensivos
        status: inviteData.status ?? 'pending',
        sentAt: inviteData.sentAt ?? Timestamp.fromDate(new Date()),
        expiresAt:
          inviteData.expiresAt ??
          Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      };

      return this.createInvite(payload);
    }).pipe(
      catchError((err) => {
        this.report(err, { op: 'sendInviteToRoom', roomId });
        this.errorNotifier.showError('Erro ao enviar convite.');
        return throwError(() => err);
      })
    );
  }
} // Linha 359