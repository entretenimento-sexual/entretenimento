// src\app\core\services\chat.service.ts
import { Injectable } from '@angular/core';
import {
  getFirestore, collection, addDoc, doc, Timestamp, setDoc,
  CollectionReference, query, where, getDocs, deleteDoc, orderBy,
  limitToLast, startAfter, onSnapshot, Query, QuerySnapshot, DocumentData, QueryDocumentSnapshot
} from 'firebase/firestore';
import { Chat } from '../../interfaces/chat.interface';
import { Message } from '../../interfaces/message.interface';
import { map, switchMap } from 'rxjs/operators';
import { Observable, from } from 'rxjs';
import { UsuarioService } from '../usuario.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { AuthService } from '../autentication/auth.service';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private db = getFirestore();

  constructor(private usuarioService: UsuarioService,
              private authService: AuthService) { }

  async getOrCreateChatId(participants: string[]): Promise<string> {
    const participantsKey = participants.sort().join('_'); // Cria uma chave única
    const chatsRef = collection(this.db, 'chats');
    const q = query(chatsRef, where('participantsKey', '==', participantsKey));

    const querySnapshot = await getDocs(q);
    let existingChatId = null;

    if (!querySnapshot.empty) {
      existingChatId = querySnapshot.docs[0].id;
      console.log(`Chat existente encontrado: ${existingChatId}`);
    }

    if (existingChatId) {
      return existingChatId;
    } else {
      return this.createChat(participants);
    }
  }

  // Para criar uma nova conversa
  async createChat(participants: string[]): Promise<string> {
    const chat: Chat = {
      participants,
      participantsKey: participants.sort().join('_'), // Adiciona a chave aqui
      timestamp: Timestamp.now()
    };

    try {
      const chatDocRef = await addDoc(collection(this.db, 'chats'), chat);
      return chatDocRef.id; // Retorna o ID do chat criado
    } catch (error) {
      console.error("Erro ao criar chat:", error);
      throw error;
    }
  }

    // Para enviar uma mensagem em uma conversa
  async sendMessage(chatId: string, message: Message): Promise<string> {
    try {
      const chatDoc = doc(this.db, 'chats', chatId);
      const messageCollection = collection(chatDoc, 'messages') as CollectionReference<Message>;
      const messageRef = await addDoc(messageCollection, message);
      return messageRef.id;
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      throw error;
    }
  }

  getChats(userId: string) {
    const chatsRef = collection(this.db, 'chats');
    const q = query(chatsRef, where('participants', 'array-contains', userId));

    return from(getDocs(q)).pipe(
      switchMap(async (querySnapshot: QuerySnapshot<DocumentData>) => {
        const chatPromises = querySnapshot.docs.map(async (doc: QueryDocumentSnapshot<DocumentData>) => {
          const chatData = doc.data() as Chat;
          const otherUserId = chatData.participants.find(uid => uid !== userId);

          // Garanta que userDetails seja null quando otherUserId for undefined
          let userDetails: IUserDados | null = null;
          if (otherUserId) {
            userDetails = await this.usuarioService.getUsuario(otherUserId).toPromise() ?? null;
          }

          return {
            ...chatData,
            id: doc.id,
            otherParticipantDetails: userDetails
          };
        });
        return await Promise.all(chatPromises);
      }),
      map(chatsWithDetails => chatsWithDetails.filter(chat => chat.otherParticipantDetails != null))
    );
  }

  async updateChat(chatId: string, updateData: Partial<Chat>): Promise<string> {
    try {
      const chatDocRef = doc(this.db, 'chats', chatId);
      await setDoc(chatDocRef, updateData, { merge: true });
      return chatId;
    } catch (error) {
      console.error("Erro ao atualizar chat:", error);
      throw error;
    }
  }
    async deleteChat(chatId: string): Promise < void> {
      try {
        const chatDocRef = doc(this.db, 'chats', chatId);
        await deleteDoc(chatDocRef);
      } catch(error) {
        console.error("Erro ao deletar chat:", error);
        throw error;
      }
    }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    try {
      const messageDocRef = doc(this.db, `chats/${chatId}/messages`, messageId);
      await deleteDoc(messageDocRef);
    } catch (error) {
      console.error("Erro ao deletar mensagem:", error);
      throw error;
    }
  }

  getMessages(chatId: string, limit: number = 10, lastMessageTimestamp?: Timestamp, realtime: boolean = false): Observable<Message[]> {
    const messagesRef = collection(this.db, `chats/${chatId}/messages`);
    let q: Query<DocumentData>;

    if (lastMessageTimestamp) {
      q = query(messagesRef, orderBy('timestamp', 'desc'), startAfter(lastMessageTimestamp), limitToLast(limit));
    } else {
      q = query(messagesRef, orderBy('timestamp', 'desc'), limitToLast(limit));
    }

    if (realtime) {
      return new Observable(observer => {
        const unsubscribe = onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
          const messages = snapshot.docs.map(doc => doc.data() as Message);
          observer.next(messages);
        }, observer.error);

        return { unsubscribe };
      });
    } else {
      return from(getDocs(q)).pipe(
        map(querySnapshot => {
          return querySnapshot.docs.map(doc => doc.data() as Message);
        })
      );
    }
  }
}
