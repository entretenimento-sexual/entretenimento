// src/app/core/services/batepapo/room-services/room-management.service.ts
import { Inject, Injectable } from '@angular/core';
import {Firestore, collection, addDoc, updateDoc, deleteDoc, doc
        } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';

@Injectable({ providedIn: 'root' })
export class RoomManagementService {

  constructor(@Inject(Firestore) private db: Firestore,
              private errorNotifier: ErrorNotificationService) {}

  /**
   * Cria uma nova sala.
   * @param roomDetails Campos parciais de IRoom (ex.: roomName, participants, etc.)
   * @param creatorId UID do criador da sala.
   * @returns Observable com a sala criada (IRoom).
   */
  createRoom(roomDetails: Partial<IRoom>, creatorId: string): Observable<IRoom> {
    const participants = Array.from(new Set([creatorId, ...(roomDetails.participants ?? [])]));

    // Monta o payload que será persistido (sem o id)
    const roomData: Omit<IRoom, 'id'> = {
      roomName: roomDetails.roomName ?? 'Sala sem nome',
      createdBy: creatorId,
      participants,
      creationTime: new Date(),
      description: roomDetails.description,
      expirationDate: roomDetails.expirationDate,
      maxParticipants: roomDetails.maxParticipants,
      isPrivate: roomDetails.isPrivate,
      roomType: roomDetails.roomType,
      lastActivity: new Date(),
      visibility: roomDetails.visibility,
      lastMessage: roomDetails.lastMessage,
      isRoom: true,
    };

    return new Observable<IRoom>((observer) => {
      addDoc(collection(this.db, 'rooms'), roomData as any)
        .then((docRef) => {
          observer.next({ id: docRef.id, ...roomData });
          observer.complete();
        })
        .catch((error) => {
          this.errorNotifier.showError('Erro ao criar sala.');
          observer.error(error);
        });
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
      this.errorNotifier.showError('Erro ao atualizar sala.');
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
      this.errorNotifier.showError('Erro ao deletar sala.');
      throw error;
    }
  }
}
