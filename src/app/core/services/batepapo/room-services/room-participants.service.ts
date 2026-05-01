// src/app/core/services/batepapo/room-services/room-participants.service.ts
// Serviço para gerenciar participantes de salas de bate-papo usando Firestore.
//
// Ajustes desta versão:
// - protege collection/doc/getDoc/onSnapshot/runTransaction com FirestoreContextService
// - mantém Observable-first
// - mantém transação de membership
// - não recoloca lógica de aceite de convite aqui

import { Injectable, NgZone } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
} from '@angular/fire/firestore';
import {
  Observable,
  defer,
  from,
  map,
  catchError,
  firstValueFrom,
  switchMap,
  of,
  throwError,
  take,
} from 'rxjs';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { UserRoomIdsService } from './user-room-ids.service';
import { AuthSessionService } from '../../autentication/auth/auth-session.service';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

type RoomParticipantDoc = {
  uid: string;
  joinedAt?: number | null;
  removedAt?: number | null;
  removed?: boolean;
};

@Injectable({ providedIn: 'root' })
export class RoomParticipantsService {
  constructor(
    private readonly db: Firestore,
    private readonly zone: NgZone,
    private readonly ctx: FirestoreContextService,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly userRoomIds: UserRoomIdsService,
    private readonly authSession: AuthSessionService
  ) {}

  private norm(v: string | null | undefined): string {
    return (v ?? '').trim();
  }

  private fail<T>(
    userMessage: string,
    err: unknown,
    context?: Record<string, unknown>
  ): Observable<T> {
    this.notify.showError(userMessage);

    try {
      const e = err instanceof Error ? err : new Error(userMessage);
      (e as any).original = err;
      (e as any).context = {
        scope: 'RoomParticipantsService',
        ...(context ?? {}),
      };
      (e as any).skipUserNotification = true;
      this.globalError.handleError(e);
    } catch {}

    return throwError(() => err);
  }

  private reportSilent(err: unknown, context?: Record<string, unknown>): void {
    try {
      const e =
        err instanceof Error
          ? err
          : new Error('[RoomParticipantsService] stream error');

      (e as any).original = err;
      (e as any).context = {
        scope: 'RoomParticipantsService',
        ...(context ?? {}),
      };
      (e as any).silent = true;
      (e as any).skipUserNotification = true;
      this.globalError.handleError(e);
    } catch {}
  }

  private roomRef(roomId: string) {
    const rid = this.norm(roomId);
    return this.ctx.run(() => doc(this.db, 'rooms', rid));
  }

  private participantRef(roomId: string, userId: string) {
    const rid = this.norm(roomId);
    const uid = this.norm(userId);

    return this.ctx.run(() =>
      doc(this.db, 'rooms', rid, 'participants', uid)
    );
  }

  private participantsCol(roomId: string) {
    const rid = this.norm(roomId);
    return this.ctx.run(() =>
      collection(this.db, `rooms/${rid}/participants`)
    );
  }

  private userRef(userId: string) {
    const uid = this.norm(userId);
    return this.ctx.run(() => doc(this.db, 'users', uid));
  }

  private withActorUid$<T>(
    operation: (actorUid: string) => Observable<T>
  ): Observable<T> {
    return this.authSession.uid$.pipe(
      take(1),
      switchMap((uid) => {
        const actorUid = this.norm(uid);

        if (!actorUid) {
          return this.fail<T>(
            'Sessão inválida para gerenciar participantes.',
            new Error('No authenticated actor'),
            { op: 'withActorUid$' }
          );
        }

        return operation(actorUid);
      })
    );
  }

  private mutateParticipantMembership$(
    actorUid: string,
    targetUid: string,
    roomId: string,
    mode: 'add' | 'remove'
  ): Observable<void> {
    const uid = this.norm(targetUid);
    const rid = this.norm(roomId);

    if (!uid || !rid) {
      return this.fail<void>(
        'Dados inválidos para alterar participante.',
        new Error('Invalid args'),
        { op: 'mutateParticipantMembership$', actorUid, targetUid, roomId, mode }
      );
    }

    const roomRef = this.roomRef(rid);
    const participantRef = this.participantRef(rid, uid);

    return defer(() =>
      from(
        this.ctx.run(() =>
          runTransaction(this.db, async (tx) => {
            const roomSnap = await tx.get(roomRef);

            if (!roomSnap.exists()) {
              throw new Error('Sala não encontrada.');
            }

            const roomData = roomSnap.data() as any;
            const createdBy = this.norm(roomData?.createdBy);
            const currentParticipants: string[] = Array.isArray(roomData?.participants)
              ? roomData.participants
              : [];

            const actorCanManage = actorUid === uid || createdBy === actorUid;
            if (!actorCanManage) {
              throw new Error('Ação não autorizada para este participante.');
            }

            const alreadyInRoom = currentParticipants.includes(uid);

            if (mode === 'add') {
              if (!alreadyInRoom) {
                tx.update(roomRef, {
                  participants: [...currentParticipants, uid],
                } as any);
              }

              const participantData: RoomParticipantDoc = {
                uid,
                joinedAt: Date.now(),
                removedAt: null,
                removed: false,
              };

              tx.set(participantRef, participantData as any, { merge: true });
              return;
            }

            if (alreadyInRoom) {
              tx.update(roomRef, {
                participants: currentParticipants.filter(
                  (participantUid) => participantUid !== uid
                ),
              } as any);
            }

            const participantData: RoomParticipantDoc = {
              uid,
              removedAt: Date.now(),
              removed: true,
            };

            tx.set(participantRef, participantData as any, { merge: true });
          })
        )
      )
    ).pipe(
      map(() => void 0),
      catchError((err) =>
        this.fail<void>(
          mode === 'add'
            ? 'Erro ao adicionar participante na sala.'
            : 'Erro ao remover participante da sala.',
          err,
          { op: 'mutateParticipantMembership$', actorUid, targetUid: uid, roomId: rid, mode }
        )
      )
    );
  }

  getParticipants(roomId: string): Observable<any[]> {
    const rid = this.norm(roomId);
    if (!rid) return of([]);

    const participantsRef = this.participantsCol(rid);

    return new Observable<any[]>((observer) => {
      const unsubscribe = this.ctx.run(() =>
        onSnapshot(
          participantsRef,
          (snapshot) => {
            this.zone.run(() => {
              const participants = snapshot.docs.map((d) => ({
                id: d.id,
                ...d.data(),
              }));
              observer.next(participants);
            });
          },
          (error) => {
            this.zone.run(() => {
              this.reportSilent(error, { op: 'getParticipants', roomId: rid });
              this.notify.showError('Erro ao carregar participantes.');
              observer.error(error);
            });
          }
        )
      );

      return () => unsubscribe();
    });
  }

  async addUserToRoom(userId: string, roomId: string): Promise<void> {
    await firstValueFrom(this.addUserToRoom$(userId, roomId));
  }

  async removeUserFromRoom(userId: string, roomId: string): Promise<void> {
    await firstValueFrom(this.removeUserFromRoom$(userId, roomId));
  }

  addUserToRoom$(userId: string, roomId: string): Observable<void> {
    const uid = this.norm(userId);
    const rid = this.norm(roomId);

    if (!uid || !rid) {
      return this.fail<void>(
        'Dados inválidos para adicionar participante.',
        new Error('Invalid args'),
        { op: 'addUserToRoom$', userId, roomId }
      );
    }

    return this.withActorUid$((actorUid) =>
      this.mutateParticipantMembership$(actorUid, uid, rid, 'add').pipe(
        switchMap(() => this.userRoomIds.addRoomId$(uid, rid)),
        map(() => void 0),
        catchError((err) =>
          this.fail<void>(
            'Erro ao adicionar participante na sala.',
            err,
            { op: 'addUserToRoom$', actorUid, targetUid: uid, roomId: rid }
          )
        )
      )
    );
  }

  removeUserFromRoom$(userId: string, roomId: string): Observable<void> {
    const uid = this.norm(userId);
    const rid = this.norm(roomId);

    if (!uid || !rid) {
      return this.fail<void>(
        'Dados inválidos para remover participante.',
        new Error('Invalid args'),
        { op: 'removeUserFromRoom$', userId, roomId }
      );
    }

    return this.withActorUid$((actorUid) =>
      this.mutateParticipantMembership$(actorUid, uid, rid, 'remove').pipe(
        switchMap(() => this.userRoomIds.removeRoomId$(uid, rid)),
        map(() => void 0),
        catchError((err) =>
          this.fail<void>(
            'Erro ao remover participante da sala.',
            err,
            { op: 'removeUserFromRoom$', actorUid, targetUid: uid, roomId: rid }
          )
        )
      )
    );
  }

  getRoomCreator(roomId: string): Observable<IUserDados> {
    const rid = this.norm(roomId);
    if (!rid) {
      return this.fail<IUserDados>(
        'Sala não encontrada.',
        new Error('roomId vazio'),
        { op: 'getRoomCreator', roomId }
      );
    }

    const roomRef = this.roomRef(rid);

    return defer(() => from(this.ctx.run(() => getDoc(roomRef)))).pipe(
      switchMap((roomSnap) => {
        if (!roomSnap.exists()) {
          return this.fail<IUserDados>(
            'Sala não encontrada.',
            new Error('Sala não existe'),
            { op: 'getRoomCreator', roomId: rid }
          );
        }

        const creatorId = this.norm((roomSnap.data() as any)?.createdBy);
        if (!creatorId) {
          return this.fail<IUserDados>(
            'Criador da sala não encontrado.',
            new Error('createdBy ausente'),
            { op: 'getRoomCreator', roomId: rid }
          );
        }

        const userRef = this.userRef(creatorId);

        return from(this.ctx.run(() => getDoc(userRef))).pipe(
          map((userSnap) => {
            if (!userSnap.exists()) {
              throw new Error('Criador da sala não encontrado.');
            }

            return {
              uid: userSnap.id,
              ...(userSnap.data() as any),
            } as IUserDados;
          })
        );
      }),
      catchError((err) =>
        this.fail<IUserDados>(
          'Erro ao buscar criador.',
          err,
          { op: 'getRoomCreator', roomId: rid }
        )
      )
    );
  }
}