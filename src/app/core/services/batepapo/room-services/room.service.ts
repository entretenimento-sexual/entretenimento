// src/app/core/services/batepapo/room-services/room.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, query, where, onSnapshot, getDocs, doc } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable({
  providedIn: 'root',
})
export class RoomService {
  private db = getFirestore();

  constructor(private errorNotifier: ErrorNotificationService) { }

  /**
   * Conta o número de salas criadas por um usuário.
   * @param userId ID do usuário.
   * @returns Promessa com o número de salas criadas.
   */
  async countUserRooms(userId: string): Promise<number> {
    try {
      const roomsCollectionRef = collection(this.db, 'rooms');
      const userRoomsQuery = query(roomsCollectionRef, where('createdBy', '==', userId));
      const userRoomsSnapshot = await getDocs(userRoomsQuery);
      return userRoomsSnapshot.docs.length;
    } catch (error) {
      this.errorNotifier.showError('Erro ao contar salas do usuário.');
      throw error;
    }
  }

  /**
   * Obtém todas as salas criadas por um usuário.
   * @param userId ID do usuário.
   * @returns Observable contendo as salas criadas.
   */
  getUserRooms(userId: string): Observable<Chat[]> {
    const roomsCollectionRef = collection(this.db, 'rooms');
    const userRoomsQuery = query(roomsCollectionRef, where('createdBy', '==', userId));

    return new Observable((observer) => {
      const unsubscribe = onSnapshot(
        userRoomsQuery,
        (snapshot) => {
          const rooms = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              roomId: doc.id,
              participants: data['participants'] || [],
              timestamp: data['timestamp'] || new Date(),
              ...data
            } as Chat;
          });
          observer.next(rooms);
        },
        (error) => {
          this.errorNotifier.showError('Erro ao carregar salas do usuário.');
          observer.error(error);
        }
      );
      return () => unsubscribe();
    });
  }

  /**
   * Obtém todas as salas disponíveis para um usuário.
   * @param userId ID do usuário.
   * @returns Observable contendo as salas que o usuário participa.
   */
  getRooms(userId: string): Observable<Chat[]> {
    const roomsCollectionRef = collection(this.db, 'rooms');
    const userRoomsQuery = query(roomsCollectionRef, where('participants', 'array-contains', userId));

    return new Observable((observer) => {
      const unsubscribe = onSnapshot(userRoomsQuery, (snapshot) => {
        const rooms = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            roomId: doc.id,
            participants: data['participants'] || [],
            timestamp: data['timestamp'] || new Date(),
            ...data
          } as Chat;
        });
        observer.next(rooms);
      }, (error) => {
        this.errorNotifier.showError('Erro ao carregar as salas.');
        observer.error(error);
      });
      return () => unsubscribe();
    });
  }

  /**
   * Obtém uma sala pelo ID.
   * @param roomId ID da sala.
   * @returns Observable contendo os detalhes da sala.
   */
  getRoomById(roomId: string): Observable<Chat> {
    const roomDocRef = doc(this.db, 'rooms', roomId);

    return new Observable((observer) => {
      const unsubscribe = onSnapshot(
        roomDocRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            observer.next({ roomId: snapshot.id, participants: data['participants'] || [], timestamp: data['timestamp'] || new Date(), ...data } as Chat);
          } else {
            observer.error('Sala não encontrada.');
          }
        },
        (error) => {
          this.errorNotifier.showError('Erro ao carregar informações da sala.');
          observer.error(error);
        }
      );
      return () => unsubscribe();
    });
  }
}
