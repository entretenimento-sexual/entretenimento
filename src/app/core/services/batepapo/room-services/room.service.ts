// src/app/core/services/batepapo/room-services/room.service.ts
// Não esqueça os comentários e ferramentas de debug
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, query, where, onSnapshot, getDocs, doc } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class RoomService {
  constructor(
    private db: Firestore,
    private errorNotifier: ErrorNotificationService,
  ) { }

  async countUserRooms(userId: string): Promise<number> {
    try {
      const roomsCol = collection(this.db, 'rooms');
      const q = query(roomsCol, where('createdBy', '==', userId));
      const snap = await getDocs(q);
      return snap.docs.length;
    } catch (error) {
      this.errorNotifier.showError('Erro ao contar salas do usuário.');
      throw error;
    }
  }

  getUserRooms(userId: string): Observable<IRoom[]> {
    const roomsCol = collection(this.db, 'rooms');
    const q = query(roomsCol, where('createdBy', '==', userId));

    return new Observable(observer => {
      const unsubscribe = onSnapshot(q, snapshot => {
        const rooms: IRoom[] = snapshot.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            roomName: data['roomName'],
            createdBy: data['createdBy'],
            participants: data['participants'] ?? [],
            // normaliza: tenta creationTime, depois createdAt/timestamp
            creationTime: data['creationTime'] ?? data['createdAt'] ?? data['timestamp'] ?? new Date(),
            lastActivity: data['lastActivity'],
            description: data['description'],
            maxParticipants: data['maxParticipants'],
            isPrivate: data['isPrivate'],
            roomType: data['roomType'],
            visibility: data['visibility'],
          };
        });
        observer.next(rooms);
      }, err => {
        this.errorNotifier.showError('Erro ao carregar salas do usuário.');
        observer.error(err);
      });
      return () => unsubscribe();
    });
  }

  getRooms(userId: string): Observable<IRoom[]> {
    const roomsCol = collection(this.db, 'rooms');
    const q = query(roomsCol, where('participants', 'array-contains', userId));

    return new Observable(observer => {
      const unsubscribe = onSnapshot(q, snapshot => {
        const rooms: IRoom[] = snapshot.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            roomName: data['roomName'],
            createdBy: data['createdBy'],
            participants: data['participants'] ?? [],
            creationTime: data['creationTime'] ?? data['createdAt'] ?? data['timestamp'] ?? new Date(),
            lastActivity: data['lastActivity'],
            description: data['description'],
            maxParticipants: data['maxParticipants'],
            isPrivate: data['isPrivate'],
            roomType: data['roomType'],
            visibility: data['visibility'],
          };
        });
        observer.next(rooms);
      }, err => {
        this.errorNotifier.showError('Erro ao carregar as salas.');
        observer.error(err);
      });
      return () => unsubscribe();
    });
  }

  getRoomById(roomId: string): Observable<IRoom> {
    const roomRef = doc(this.db, 'rooms', roomId);

    return new Observable(observer => {
      const unsubscribe = onSnapshot(roomRef, snapshot => {
        if (!snapshot.exists()) {
          observer.error('Sala não encontrada.');
          return;
        }
        const data = snapshot.data() as any;
        const room: IRoom = {
          id: snapshot.id,
          roomName: data['roomName'],
          createdBy: data['createdBy'],
          participants: data['participants'] ?? [],
          creationTime: data['creationTime'] ?? data['createdAt'] ?? data['timestamp'] ?? new Date(),
          lastActivity: data['lastActivity'],
          description: data['description'],
          maxParticipants: data['maxParticipants'],
          isPrivate: data['isPrivate'],
          roomType: data['roomType'],
          visibility: data['visibility'],
        };
        observer.next(room);
      }, err => {
        this.errorNotifier.showError('Erro ao carregar informações da sala.');
        observer.error(err);
      });
      return () => unsubscribe();
    });
  }
}/* Linha 122
 AuthSession manda no UID
/*CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
//logout() do auth.service.ts que está sendo descontinuado
// ainda está sendo usado em alguns lugares e precisa ser migrado.
Ferramentas de debug ajudam bastante
É assim que funcionam as grandes plataformas?
Compatibilizar o estado online do usuário com o presence.service e aproximar do funcionamento ideal
deixar explícito que é Firebase/AngularFire e o que é NgRx
*/
