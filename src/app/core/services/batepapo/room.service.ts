// src\app\core\services\batepapo\room.service.ts
import { Injectable } from '@angular/core';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { Observable, throwError, from } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
import {
  addDoc, collection, Timestamp, getFirestore, query, where, getDocs, serverTimestamp, updateDoc, doc, deleteDoc, onSnapshot, orderBy
} from 'firebase/firestore';
import { Message } from '../../interfaces/interfaces-chat/message.interface';
import { selectUserState } from 'src/app/store/selectors/user.selectors'; // Importa o seletor

@Injectable({
  providedIn: 'root'
})
export class RoomService {
  private db = getFirestore();

  constructor(
    private subscriptionService: SubscriptionService,
    private store: Store<AppState> // Injetando o Store para obter o estado do usuário
  ) { }

  public async countUserRooms(userId: string): Promise<number> {
    const roomsCollectionRef = collection(this.db, 'rooms');
    const userRoomsQuery = query(roomsCollectionRef, where('createdBy', '==', userId));
    const userRoomsSnapshot = await getDocs(userRoomsQuery);
    return userRoomsSnapshot.docs.length;
  }

  createRoom(roomDetails: any): Observable<any> {
    return this.store.select(selectUserState).pipe(
      take(1), // Pega o estado do usuário uma vez
      switchMap(async (state) => {
        const user = state.users[0]; // Supondo que o estado contenha o array de usuários e o primeiro seja o usuário logado
        if (!user) {
          return throwError(() => new Error('Usuário não autenticado.'));
        }

        if (!this.canCreateRoomBasedOnRole(user.role)) {
          this.subscriptionService.promptSubscription({
            title: "Exclusivo para certos roles",
            message: "Apenas usuários com certos roles podem criar salas. Deseja atualizar seu role ou assinatura?"
          });
          return throwError(() => new Error('Acesso negado: apenas usuários com roles específicos podem criar salas de bate-papo.'));
        }

        const roomCount = await this.countUserRooms(user.uid);
        const MAX_ROOMS_ALLOWED = 1; // Define o limite de salas por usuário
        if (roomCount >= MAX_ROOMS_ALLOWED) {
          return throwError(() => new Error('Limite de salas criadas por usuário alcançado.'));
        }

        const roomExpiration = user.isSubscriber ?
          (user.roomCreationSubscriptionExpires ?? Timestamp.fromDate(new Date(new Date().setFullYear(new Date().getFullYear() + 1)))) :
          Timestamp.fromDate(new Date(new Date().setDate(new Date().getDate() + 30)));

        const roomData = {
          ...roomDetails,
          expirationDate: roomExpiration,
          createdBy: user.uid
        };

        try {
          const docRef = await addDoc(collection(this.db, 'rooms'), roomData);
          return { roomId: docRef.id, ...roomData, roomCount: await this.countUserRooms(user.uid) };
        } catch (error) {
          return throwError(() => error);
        }
      })
    );
  }

  private canCreateRoomBasedOnRole(role: string): boolean {
    return ['premium', 'vip'].includes(role);
  }

  getUserRooms(userId: string): Observable<any[]> {
    return new Observable(observer => {
      const roomsCollectionRef = collection(this.db, 'rooms');
      const roomsCreatedByUserQuery = query(roomsCollectionRef, where('createdBy', '==', userId));

      const unsubscribe = onSnapshot(roomsCreatedByUserQuery, (querySnapshot) => {
        console.log("Snapshot recebido", querySnapshot);
        const rooms: any[] = [];
        querySnapshot.forEach((doc) => {
          console.log('Recuperando sala com ID:', doc.id);
          rooms.push({ roomId: doc.id, ...doc.data() });
        });

        // Verifica se algum documento foi removido
        const deletedRoomIds = querySnapshot.docChanges().filter(change => change.type === 'removed').map(change => change.doc.id);
        // Remove as salas deletadas do array
        rooms.filter(room => !deletedRoomIds.includes(room.roomId));
        observer.next(rooms); // Envia o array de salas atualizado para o subscriber

      }, error => {
        console.error("Erro ao escutar as salas do usuário:", error);
        observer.error(error);
      });
      return () => unsubscribe(); // Função para finalizar a escuta quando necessário
    });
  }

  async sendInvite(roomId: string): Promise<void> {
    const inviteDoc = {
      roomId: roomId,
      status: 'sent',
      sentTime: serverTimestamp(), // Data/hora atual
      // Incluir mais detalhes conforme necessário
    };
    // Adiciona o convite à coleção de convites
    await addDoc(collection(this.db, 'invites'), inviteDoc);
  }

  async updateRoom(roomId: string, roomDetails: any): Promise<void> {
    const roomRef = doc(this.db, 'rooms', roomId);
    await updateDoc(roomRef, roomDetails);
  }

  async deleteRoom(roomId: string): Promise<void> {
    try {
      const roomRef = doc(this.db, 'rooms', roomId);
      await deleteDoc(roomRef);
      console.log('Sala excluída com sucesso:', roomId);
    } catch (error) {
      console.error('Erro ao excluir a sala:', error);
      throw new Error('Erro ao excluir a sala.');
    }
  }

  sendMessageToRoom(roomId: string, message: Message): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const roomMessagesRef = collection(this.db, `rooms/${roomId}/messages`);
        await addDoc(roomMessagesRef, message);
        resolve();
      } catch (error) {
        console.error("Erro ao enviar mensagem para a sala:", error);
        reject(error);
      }
    });
  }

  getRoomMessages(roomId: string, realtime: boolean = false): Observable<Message[]> {
    const roomMessagesRef = collection(this.db, `rooms/${roomId}/messages`);
    let messagesQuery = query(roomMessagesRef, orderBy('timestamp', 'asc'));

    if (realtime) {
      return new Observable(observer => {
        const unsubscribe = onSnapshot(messagesQuery, snapshot => {
          const messages = snapshot.docs.map(doc => doc.data() as Message); // Mantém timestamp como Timestamp
          observer.next(messages);
        }, error => observer.error(error));

        return { unsubscribe };
      });
    } else {
      console.error('Modo não-realtime não suportado.');
      return throwError(() => new Error('Modo não-realtime não suportado.'));
    }
  }
}
