// src/app/core/services/batepapo/room-services/room.service.ts
// -----------------------------------------------------------------------------
// ROOM SERVICE
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - observar salas em tempo real com AngularFire;
// - manter métodos legados necessários para consumidores existentes;
// - expor listagem de salas das quais o usuário participa;
// - executar todas as factories Firestore dentro do Injection Context.
//
// Direção arquitetural:
// - `getRooms()` é a consulta correta para a tela "Minhas salas":
//   lista salas em que o usuário participa;
// - `getUserRooms()` permanece como consulta owner-only por compatibilidade;
// - futuramente participants[] será substituído por uma projeção de membership
//   segura e escalável.
//
// Segurança:
// - este serviço apenas lê salas permitidas pelas Rules;
// - criação permanece exclusiva da callable createPrivateRoom;
// - erros são enviados ao GlobalErrorHandlerService e propagados ao componente,
//   que decide o feedback visual ao usuário.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  getDocs,
  limit,
  query,
  where,
} from '@angular/fire/firestore';

import {
  Observable,
  firstValueFrom,
  of,
  throwError,
} from 'rxjs';
import {
  catchError,
  map,
  switchMap,
  take,
} from 'rxjs/operators';

import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

type RoomFirestoreDocument = Partial<IRoom> & {
  id?: unknown;
  roomId?: unknown;
  roomName?: unknown;
  createdBy?: unknown;
  participants?: unknown;
  creationTime?: unknown;
  lastActivity?: unknown;
  description?: unknown;
  isPrivate?: unknown;
  roomType?: unknown;
  visibility?: unknown;
  status?: unknown;
  memberCount?: unknown;
  membershipMode?: unknown;
  policyVersion?: unknown;
};

export type RoomListItem = IRoom & {
  id: string;
  roomId: string;
  status: string;
  memberCount: number;
  membershipMode: string | null;
  policyVersion: string | null;
};

@Injectable({ providedIn: 'root' })
export class RoomService {
  private readonly db = inject(Firestore);
  private readonly ctx = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  /**
   * Mantém a nomenclatura já utilizada pelo projeto.
   * Conta apenas salas próprias ainda consideradas ativas.
   *
   * Observação:
   * - esta contagem continua útil para UI legada;
   * - a autoridade final do limite permanece na callable createPrivateRoom.
   */
  async countUserRooms(userId: string): Promise<number> {
    const uid = this.requireUid(userId);

    return firstValueFrom(
      this.ctx.deferPromise$(() => {
        const roomsRef = collection(this.db, 'rooms');
        const ownedRoomsQuery = query(
          roomsRef,
          where('createdBy', '==', uid)
        );

        return getDocs(ownedRoomsQuery);
      }).pipe(
        map((snapshot) =>
          snapshot.docs
            .map((document) => document.data() as RoomFirestoreDocument)
            .filter((room) => this.isActiveStatus(room.status))
            .length
        ),
        take(1),
        catchError((error) =>
          this.propagateError<number>(
            error,
            'countUserRooms',
            { uid }
          )
        )
      )
    );
  }

  /**
   * Consulta owner-only preservada para compatibilidade com consumidores
   * antigos que precisem listar apenas salas criadas pelo usuário.
   *
   * Para a tela principal de salas, use getRooms().
   */
  getUserRooms(userId: string): Observable<RoomListItem[]> {
    const uid = this.requireUid(userId);

    return this.observeRoomsByCreatedBy$(uid);
  }

  /**
   * Consulta canônica para "Minhas salas".
   *
   * Nesta fase, participants[] ainda é mantido por compatibilidade.
   * Assim que membership for integralmente migrado para backend/projeção,
   * este método poderá consultar a estrutura escalável correspondente.
   */
  getRooms(userId: string): Observable<RoomListItem[]> {
    const uid = this.requireUid(userId);

    return this.observeRoomsByMembership$(uid);
  }

  /**
   * Observa uma sala específica.
   *
   * A leitura somente será permitida pelas Rules se o usuário puder acessar
   * efetivamente a sala.
   */
  getRoomById(roomId: string): Observable<RoomListItem> {
    const id = String(roomId ?? '').trim();

    if (!id) {
      return throwError(() => new Error('roomId ausente para consulta da sala.'));
    }

    return this.ctx.deferObservable$(() => {
      const roomRef = doc(this.db, 'rooms', id);

      return docData(roomRef, { idField: 'id' }) as Observable<
        RoomFirestoreDocument | undefined
      >;
    }).pipe(
      switchMap((room) => {
        if (!room) {
          return throwError(() => new Error('Sala não encontrada.'));
        }

        return of(this.toRoomListItem(room));
      }),
      catchError((error) =>
        this.propagateError<RoomListItem>(
          error,
          'getRoomById',
          { roomId: id }
        )
      )
    );
  }

  private observeRoomsByMembership$(uid: string): Observable<RoomListItem[]> {
    return this.ctx.deferObservable$(() => {
      const roomsRef = collection(this.db, 'rooms');
      const membershipQuery = query(
        roomsRef,
        where('participants', 'array-contains', uid),
        limit(30)
      );

      return collectionData(membershipQuery, { idField: 'id' }) as Observable<
        RoomFirestoreDocument[]
      >;
    }).pipe(
      map((rooms) => this.normalizeAndSortRooms(rooms)),
      catchError((error) =>
        this.propagateError<RoomListItem[]>(
          error,
          'getRooms',
          { uid, queryMode: 'participants-array-contains' }
        )
      )
    );
  }

  private observeRoomsByCreatedBy$(uid: string): Observable<RoomListItem[]> {
    return this.ctx.deferObservable$(() => {
      const roomsRef = collection(this.db, 'rooms');
      const ownershipQuery = query(
        roomsRef,
        where('createdBy', '==', uid)
      );

      return collectionData(ownershipQuery, { idField: 'id' }) as Observable<
        RoomFirestoreDocument[]
      >;
    }).pipe(
      map((rooms) => this.normalizeAndSortRooms(rooms)),
      catchError((error) =>
        this.propagateError<RoomListItem[]>(
          error,
          'getUserRooms',
          { uid, queryMode: 'createdBy' }
        )
      )
    );
  }

  private normalizeAndSortRooms(
    rooms: RoomFirestoreDocument[] | null | undefined
  ): RoomListItem[] {
    return (rooms ?? [])
      .map((room) => this.toRoomListItem(room))
      .sort(
        (first, second) =>
          this.toMillis(second.lastActivity ?? second.creationTime) -
          this.toMillis(first.lastActivity ?? first.creationTime)
      );
  }

  private toRoomListItem(room: RoomFirestoreDocument): RoomListItem {
    const id = String(room.id ?? room.roomId ?? '').trim();
    const participants = Array.isArray(room.participants)
      ? room.participants.filter(
          (participant): participant is string =>
            typeof participant === 'string' && participant.trim().length > 0
        )
      : [];

    const roomName =
      String(room.roomName ?? '').trim() || 'Sala privada';

    const memberCount =
      typeof room.memberCount === 'number' &&
      Number.isFinite(room.memberCount) &&
      room.memberCount >= 0
        ? Math.trunc(room.memberCount)
        : participants.length;

    return {
      ...(room as IRoom),
      id,
      roomId: id,
      roomName,
      createdBy: String(room.createdBy ?? '').trim(),
      participants,
      description:
        typeof room.description === 'string' && room.description.trim()
          ? room.description.trim()
          : undefined,
      isPrivate: room.isPrivate !== false,
      roomType:
        typeof room.roomType === 'string'
          ? room.roomType
          : 'private',
      visibility:
        typeof room.visibility === 'string'
          ? room.visibility
          : 'hidden',
      status:
        typeof room.status === 'string'
          ? room.status
          : 'active',
      memberCount,
      membershipMode:
        typeof room.membershipMode === 'string'
          ? room.membershipMode
          : null,
      policyVersion:
        typeof room.policyVersion === 'string'
          ? room.policyVersion
          : null,
    } as RoomListItem;
  }

  private isActiveStatus(status: unknown): boolean {
    return status !== 'closed' && status !== 'archived';
  }

  private toMillis(value: unknown): number {
    if (value instanceof Date) {
      return value.getTime();
    }

    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { toMillis?: unknown }).toMillis === 'function'
    ) {
      return (value as { toMillis: () => number }).toMillis();
    }

    return 0;
  }

  private requireUid(userId: string): string {
    const uid = String(userId ?? '').trim();

    if (!uid) {
      throw new Error('UID ausente para consulta de salas.');
    }

    return uid;
  }

  private propagateError<T>(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): Observable<T> {
    try {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(`[RoomService.${operation}] operação falhou.`);

      (normalizedError as any).feature = 'rooms';
      (normalizedError as any).operation = operation;
      (normalizedError as any).context = context;
      (normalizedError as any).original = error;
      (normalizedError as any).skipUserNotification = true;

      this.globalError.handleError(normalizedError);
    } catch {
      // noop
    }

    return throwError(() => error);
  }
}