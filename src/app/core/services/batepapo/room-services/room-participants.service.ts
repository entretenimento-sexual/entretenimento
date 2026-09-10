// src/app/core/services/batepapo/room-services/room-participants.service.ts
// Compatibilidade de participantes legados: leitura permitida; mutações congeladas.

import { Injectable, NgZone } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
} from '@angular/fire/firestore';
import {
  Observable,
  catchError,
  defer,
  firstValueFrom,
  from,
  map,
  of,
  switchMap,
  throwError,
} from 'rxjs';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class RoomParticipantsService {
  constructor(
    private readonly db: Firestore,
    private readonly zone: NgZone,
    private readonly ctx: FirestoreContextService,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  private norm(value: string | null | undefined): string {
    return (value ?? '').trim();
  }

  private fail<T>(
    userMessage: string,
    err: unknown,
    context?: Record<string, unknown>
  ): Observable<T> {
    this.notify.showError(userMessage);
    this.reportSilent(err, context);
    return throwError(() => err);
  }

  private reportSilent(err: unknown, context?: Record<string, unknown>): void {
    try {
      const error =
        err instanceof Error
          ? err
          : new Error('[RoomParticipantsService] stream error');

      (error as any).original = err;
      (error as any).context = {
        scope: 'RoomParticipantsService',
        ...(context ?? {}),
      };
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      this.globalError.handleError(error);
    } catch {
      // Telemetria nunca deve substituir a falha original.
    }
  }

  private roomRef(roomId: string) {
    const rid = this.norm(roomId);
    return this.ctx.run(() => doc(this.db, 'rooms', rid));
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

  /**
   * SUPRESSÃO EXPLÍCITA: a antiga transação de membership foi removida. As Rules
   * negam mutações de participantes e Salas não podem adquirir novos membros.
   */
  addUserToRoom$(userId: string, roomId: string): Observable<void> {
    return this.blockDeprecatedMutation$('addUserToRoom$', userId, roomId);
  }

  /**
   * SUPRESSÃO EXPLÍCITA: remoção de membership pelo navegador também foi retirada.
   * O encerramento da Sala é a operação canônica de limpeza do domínio legado.
   */
  removeUserFromRoom$(userId: string, roomId: string): Observable<void> {
    return this.blockDeprecatedMutation$('removeUserFromRoom$', userId, roomId);
  }

  async addUserToRoom(userId: string, roomId: string): Promise<void> {
    await firstValueFrom(this.addUserToRoom$(userId, roomId));
  }

  async removeUserFromRoom(userId: string, roomId: string): Promise<void> {
    await firstValueFrom(this.removeUserFromRoom$(userId, roomId));
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
              const participants = snapshot.docs.map((participant) => ({
                id: participant.id,
                ...participant.data(),
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
      switchMap((roomSnapshot) => {
        if (!roomSnapshot.exists()) {
          return this.fail<IUserDados>(
            'Sala não encontrada.',
            new Error('Sala não existe'),
            { op: 'getRoomCreator', roomId: rid }
          );
        }

        const creatorId = this.norm((roomSnapshot.data() as any)?.createdBy);
        if (!creatorId) {
          return this.fail<IUserDados>(
            'Criador da sala não encontrado.',
            new Error('createdBy ausente'),
            { op: 'getRoomCreator', roomId: rid }
          );
        }

        const userRef = this.userRef(creatorId);

        return from(this.ctx.run(() => getDoc(userRef))).pipe(
          map((userSnapshot) => {
            if (!userSnapshot.exists()) {
              throw new Error('Criador da sala não encontrado.');
            }

            return {
              uid: userSnapshot.id,
              ...(userSnapshot.data() as any),
            } as IUserDados;
          })
        );
      }),
      catchError((error) =>
        this.fail<IUserDados>(
          'Erro ao buscar criador.',
          error,
          { op: 'getRoomCreator', roomId: rid }
        )
      )
    );
  }

  private blockDeprecatedMutation$(
    operation: string,
    userId: string,
    roomId: string
  ): Observable<void> {
    const uid = this.norm(userId);
    const rid = this.norm(roomId);

    if (!uid || !rid) {
      return this.fail<void>(
        'Dados inválidos para alterar participante.',
        new Error('Invalid args'),
        { op: operation, userId, roomId }
      );
    }

    return defer(() => {
      const error = new Error(
        'Participantes de Salas legadas não podem mais ser alterados.'
      );
      (error as any).code = 'failed-precondition';
      this.reportSilent(error, {
        op: operation,
        targetUid: uid,
        roomId: rid,
        productState: 'deprecated_compatibility_only',
      });
      this.notify.showInfo(
        'Participantes de Salas não podem mais ser alterados. Use Comunidades para membership e papéis.'
      );
      return throwError(() => error);
    });
  }
}
