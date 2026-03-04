// src/app/core/services/batepapo/room-services/room-management.service.ts
import { Inject, Injectable } from '@angular/core';
import {Firestore, collection, addDoc, updateDoc, deleteDoc, doc
        } from '@angular/fire/firestore';
import { serverTimestamp } from 'firebase/firestore';
import { catchError, defer, from, map, Observable, throwError } from 'rxjs';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class RoomManagementService {

  constructor(
    @Inject(Firestore) private db: Firestore,
    private globalError: GlobalErrorHandlerService,
    private notify: ErrorNotificationService
  ) { }

  /**
   * Cria uma nova sala.
   * @param roomDetails Campos parciais de IRoom (ex.: roomName, participants, etc.)
   * @param creatorId UID do criador da sala.
   * @returns Observable com a sala criada (IRoom).
   */
  createRoom(roomDetails: Partial<IRoom>, creatorId: string): Observable<IRoom> {
    return defer(() => {
      const uid = (creatorId ?? '').trim();
      if (!uid) return throwError(() => new Error('creatorId inválido.'));

      const participants = Array.from(new Set([uid, ...(roomDetails.participants ?? [])]));

      const roomData: any = {
        roomName: roomDetails.roomName ?? 'Sala sem nome',
        createdBy: uid,
        participants,
        creationTime: serverTimestamp(),
        lastActivity: serverTimestamp(),
        description: roomDetails.description ?? null,
        expirationDate: roomDetails.expirationDate ?? null,
        maxParticipants: roomDetails.maxParticipants ?? null,
        isPrivate: roomDetails.isPrivate ?? null,
        roomType: roomDetails.roomType ?? null,
        visibility: roomDetails.visibility ?? null,
        isRoom: true,
      };

      return from(addDoc(collection(this.db, 'rooms'), roomData)).pipe(
        map((docRef) => ({ id: docRef.id, ...roomData } as IRoom)),
        catchError((err) => {
          // centralizado
          try {
            const e = new Error('[RoomManagementService.createRoom] falhou');
            (e as any).original = err;
            this.globalError.handleError(e);
          } catch { }
          this.notify.showError('Erro ao criar sala.');
          return throwError(() => err);
        })
      );
    });
  }

  /**
   * Atualiza uma sala existente.
   * @param roomId ID da sala.
   * @param roomDetails Campos a atualizar (parciais de IRoom).
   */
  async updateRoom(roomId: string, roomDetails: Partial<IRoom>): Promise<void> {
    try {
      const roomRef = doc(this.db, 'rooms', roomId);
      await updateDoc(roomRef, { ...roomDetails, lastActivity: new Date() } as any);
    } catch (error) {
      this.notify.showError('Erro ao atualizar sala.');
      throw error;
    }
  }

  /**
   * Exclui uma sala existente.
   * @param roomId ID da sala a ser excluída.
   */
  async deleteRoom(roomId: string): Promise<void> {
    try {
      const roomRef = doc(this.db, 'rooms', roomId);
      await deleteDoc(roomRef);
    } catch (error) {
      this.notify.showError('Erro ao deletar sala.');
      throw error;
    }
  }
}
