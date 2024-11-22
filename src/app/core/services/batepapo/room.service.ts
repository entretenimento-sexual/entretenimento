// src/app/core/services/batepapo/room.service.ts
import { Injectable } from '@angular/core';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { Observable, throwError, from } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
import { addDoc, collection, Timestamp, getFirestore, query, where, getDocs, serverTimestamp,
       updateDoc, doc, deleteDoc, onSnapshot, orderBy,  arrayUnion } from 'firebase/firestore';
import { Message } from '../../interfaces/interfaces-chat/message.interface';
import { selectUserState } from 'src/app/store/selectors/selectors.user/user.selectors';

@Injectable({
  providedIn: 'root'
})
export class RoomService {
  private db = getFirestore();

  constructor(
    private subscriptionService: SubscriptionService,
    private store: Store<AppState>
  ) { }

  public async countUserRooms(userId: string): Promise<number> {
    console.log('Contando salas criadas pelo usuário com ID:', userId);
    const roomsCollectionRef = collection(this.db, 'rooms');
    const userRoomsQuery = query(roomsCollectionRef, where('createdBy', '==', userId));
    const userRoomsSnapshot = await getDocs(userRoomsQuery);
    console.log('Total de salas encontradas:', userRoomsSnapshot.docs.length);
    return userRoomsSnapshot.docs.length;
  }

  createRoom(roomDetails: any): Observable<any> {
    console.log('Tentando criar uma nova sala com detalhes:', roomDetails);
    return this.store.select(selectUserState).pipe(
      take(1),
      switchMap(async (state) => {
        const user = state.users[0];
        if (!user) {
          console.error('Usuário não autenticado');
          return throwError(() => new Error('Usuário não autenticado.'));
        }

        if (!this.canCreateRoomBasedOnRole(user.role)) {
          console.log('Usuário não tem permissão para criar sala');
          this.subscriptionService.promptSubscription({
            title: "Exclusivo para certos roles",
            message: "Apenas usuários com certos roles podem criar salas. Deseja atualizar seu role ou assinatura?"
          });
          return throwError(() => new Error('Acesso negado.'));
        }

        const roomCount = await this.countUserRooms(user.uid);
        const MAX_ROOMS_ALLOWED = 1;
        if (roomCount >= MAX_ROOMS_ALLOWED) {
          console.log('Usuário já atingiu o limite de salas criadas');
          return throwError(() => new Error('Limite de salas alcançado.'));
        }

        const roomExpiration = user.isSubscriber
          ? (user.roomCreationSubscriptionExpires ?? Timestamp.fromDate(new Date(new Date().setFullYear(new Date().getFullYear() + 1))))
          : Timestamp.fromDate(new Date(new Date().setDate(new Date().getDate() + 30)));

        const roomData = {
          ...roomDetails,
          expirationDate: roomExpiration,
          createdBy: user.uid
        };

        try {
          const docRef = await addDoc(collection(this.db, 'rooms'), roomData);
          console.log('Sala criada com ID:', docRef.id);
          return { roomId: docRef.id, ...roomData, roomCount: await this.countUserRooms(user.uid) };
        } catch (error) {
          console.error('Erro ao criar a sala:', error);
          return throwError(() => error);
        }
      })
    );
  }

  private canCreateRoomBasedOnRole(role: string): boolean {
    console.log('Verificando permissão de criação de sala para o role:', role);
    return ['premium', 'vip'].includes(role);
  }

  getUserRooms(userId: string): Observable<any[]> {
    console.log('Obtendo salas criadas pelo usuário com ID:', userId);
    return new Observable(observer => {
      const roomsCollectionRef = collection(this.db, 'rooms');
      const roomsCreatedByUserQuery = query(roomsCollectionRef, where('createdBy', '==', userId));

      const unsubscribe = onSnapshot(roomsCreatedByUserQuery, (querySnapshot) => {
        console.log('Snapshot recebido:', querySnapshot.docs.length, 'salas.');
        const rooms: any[] = [];
        querySnapshot.forEach((doc) => {
          rooms.push({ roomId: doc.id, ...doc.data() });
        });
        observer.next(rooms);
        console.log('Rooms processadas:', rooms);
      }, error => {
        console.error('Erro ao buscar salas do usuário:', error);
        observer.error(error);
      });
      return () => unsubscribe();
    });
  }


  async sendInvite(roomId: string): Promise<void> {
    console.log('Enviando convite para a sala com ID:', roomId);
    const inviteDoc = {
      roomId: roomId,
      status: 'sent',
      sentTime: serverTimestamp()
    };
    try {
      await addDoc(collection(this.db, 'invites'), inviteDoc);
      console.log('Convite enviado com sucesso para a sala:', roomId);
    } catch (error) {
      console.error('Erro ao enviar convite:', error);
    }
  }

  async updateRoom(roomId: string, roomDetails: any): Promise<void> {
    console.log('Atualizando a sala com ID:', roomId, 'Detalhes:', roomDetails);
    const roomRef = doc(this.db, 'rooms', roomId);
    try {
      await updateDoc(roomRef, roomDetails);
      console.log('Sala atualizada com sucesso');
    } catch (error) {
      console.error('Erro ao atualizar a sala:', error);
    }
  }

  async addUserToRoom(roomId: string, userId: string): Promise<void> {
    const roomRef = doc(this.db, 'rooms', roomId);
    return updateDoc(roomRef, {
      members: arrayUnion(userId)
    });
  }

  async deleteRoom(roomId: string): Promise<void> {
    console.log('Deletando sala com ID:', roomId);
    const roomRef = doc(this.db, 'rooms', roomId);
    try {
      await deleteDoc(roomRef);
      console.log('Sala deletada com sucesso:', roomId);
    } catch (error) {
      console.error('Erro ao deletar a sala:', error);
      throw new Error('Erro ao excluir a sala.');
    }
  }

  sendMessageToRoom(roomId: string, message: Message): Promise<void> {
    console.log('Enviando mensagem para sala ID:', roomId, 'Mensagem:', message);
    return new Promise(async (resolve, reject) => {
      try {
        const roomMessagesRef = collection(this.db, `rooms/${roomId}/messages`);
        await addDoc(roomMessagesRef, message);
        console.log('Mensagem enviada com sucesso para a sala:', roomId);
        resolve();
      } catch (error) {
        console.error("Erro ao enviar mensagem para a sala:", error);
        reject(error);
      }
    });
  }

  getRoomParticipants(roomId: string): Observable<{ nickname: string; photoURL?: string }[]> {
    console.log(`Obtendo participantes para a sala com ID: ${roomId}`);

    return new Observable(observer => {
      const participantsCollectionRef = collection(this.db, `rooms/${roomId}/participants`);
      const unsubscribe = onSnapshot(participantsCollectionRef, (querySnapshot) => {
        const participants: { nickname: string; photoURL?: string }[] = [];
        querySnapshot.forEach(doc => {
          participants.push(doc.data() as { nickname: string; photoURL?: string });
        });
        observer.next(participants);
        console.log('Participantes processados:', participants);
      }, error => {
        console.error('Erro ao buscar participantes da sala:', error);
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }


  getRoomMessages(roomId: string, realtime: boolean = false): Observable<Message[]> {
    console.log('Obtendo mensagens para sala ID:', roomId, 'Modo Realtime:', realtime);
    const roomMessagesRef = collection(this.db, `rooms/${roomId}/messages`);
    const messagesQuery = query(roomMessagesRef, orderBy('timestamp', 'asc'));

    if (realtime) {
      return new Observable(observer => {
        const unsubscribe = onSnapshot(messagesQuery, snapshot => {
          const messages = snapshot.docs.map(doc => doc.data() as Message);
          console.log('Mensagens em tempo real recebidas:', messages);
          observer.next(messages);
        }, error => observer.error(error));

        return { unsubscribe };
      });
    } else {
      console.error('Modo não-realtime não suportado.');
      return throwError(() => new Error('Modo não-realtime não suportado.'));
    }
  }

  async getRooms(): Promise<any[]> {
    console.log("Obtendo todas as salas.");
    const roomsCollectionRef = collection(this.db, 'rooms');
    const querySnapshot = await getDocs(roomsCollectionRef);
    const rooms = querySnapshot.docs.map(doc => ({ roomId: doc.id, ...doc.data() }));
    console.log("Salas obtidas:", rooms);
    return rooms;
  }
}
