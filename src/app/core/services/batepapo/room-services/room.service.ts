import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import {
  RoomFirestoreDocument,
  RoomFirestoreGateway,
} from './room-firestore.gateway';

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
  private readonly gateway = inject(RoomFirestoreGateway);
  private readonly globalError = inject(GlobalErrorHandlerService);

  async countUserRooms(userId: string): Promise<number> {
    const uid = this.requireUid(userId);

    return firstValueFrom(
      this.gateway.fetchOwnedRooms$(uid).pipe(
        map((rooms) =>
          rooms.filter((room) => this.isActiveStatus(room.status)).length
        ),
        take(1),
        catchError((error) =>
          this.propagateError<number>(error, 'countUserRooms', { uid })
        )
      )
    );
  }

  getUserRooms(userId: string): Observable<RoomListItem[]> {
    const uid = this.requireUid(userId);

    return this.gateway.watchOwnedRooms$(uid).pipe(
      map((rooms) => this.normalizeAndSortRooms(rooms)),
      catchError((error) =>
        this.propagateError<RoomListItem[]>(error, 'getUserRooms', {
          uid,
          queryMode: 'createdBy',
        })
      )
    );
  }

  getRooms(userId: string): Observable<RoomListItem[]> {
    const uid = this.requireUid(userId);

    return this.gateway.watchMemberRooms$(uid).pipe(
      map((rooms) => this.normalizeAndSortRooms(rooms)),
      catchError((error) =>
        this.propagateError<RoomListItem[]>(error, 'getRooms', {
          uid,
          queryMode: 'participants-array-contains',
        })
      )
    );
  }

  getRoomById(roomId: string): Observable<RoomListItem> {
    const id = String(roomId ?? '').trim();

    if (!id) {
      return throwError(() => new Error('roomId ausente para consulta da sala.'));
    }

    return this.gateway.watchRoom$(id).pipe(
      switchMap((room) => {
        if (!room) {
          return throwError(() => new Error('Sala não encontrada.'));
        }

        return of(this.toRoomListItem(room));
      }),
      catchError((error) =>
        this.propagateError<RoomListItem>(error, 'getRoomById', {
          roomId: id,
        })
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
    const roomName = String(room.roomName ?? '').trim() || 'Sala privada';
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
        typeof room.roomType === 'string' ? room.roomType : 'private',
      visibility:
        typeof room.visibility === 'string' ? room.visibility : 'hidden',
      status: typeof room.status === 'string' ? room.status : 'active',
      memberCount,
      membershipMode:
        typeof room.membershipMode === 'string'
          ? room.membershipMode
          : null,
      policyVersion:
        typeof room.policyVersion === 'string' ? room.policyVersion : null,
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
      // O erro original continua sendo propagado ao consumidor.
    }

    return throwError(() => error);
  }
}
