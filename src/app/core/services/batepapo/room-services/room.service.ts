// src/app/core/services/batepapo/room.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { Observable } from 'rxjs';
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
  getUserRooms(userId: string): Observable<any[]> {
    const roomsCollectionRef = collection(this.db, 'rooms');
    const userRoomsQuery = query(roomsCollectionRef, where('createdBy', '==', userId));

    return new Observable((observer) => {
      const unsubscribe = onSnapshot(
        userRoomsQuery,
        (snapshot) => {
          const rooms = snapshot.docs.map((doc) => ({ roomId: doc.id, ...doc.data() }));
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
   * Obtém todas as salas disponíveis.
   * @returns Promessa contendo a lista de salas.
   */
  async getRooms(): Promise<any[]> {
    try {
      const roomsCollectionRef = collection(this.db, 'rooms');
      const querySnapshot = await getDocs(roomsCollectionRef);
      return querySnapshot.docs.map((doc) => ({ roomId: doc.id, ...doc.data() }));
    } catch (error) {
      this.errorNotifier.showError('Erro ao carregar salas.');
      throw error;
    }
  }
}
