// src\app\core\services\chat.service.ts
import { Injectable } from '@angular/core';
import {
  getFirestore, collection, addDoc, doc, Timestamp, setDoc,
  CollectionReference, query, where, getDocs, deleteDoc, orderBy,
  startAfter, onSnapshot, Query, QuerySnapshot, DocumentData, getDoc
} from 'firebase/firestore';
import { Chat } from '../../interfaces/interfaces-chat/chat.interface';
import { Message } from '../../interfaces/interfaces-chat/message.interface';
import { map } from 'rxjs/operators';
import { Observable, from } from 'rxjs';
import { UsuarioService } from '../usuario.service';

@Injectable({
  providedIn: 'root'
})

export class ChatService {
  private db = getFirestore();

  constructor(private usuarioService: UsuarioService) { }

  async getOrCreateChatId(participants: string[]): Promise<string> {
    const participantsKey = participants.sort().join('_'); // Cria uma chave única
    const chatsRef = collection(this.db, 'chats');
    const q = query(chatsRef, where('participantsKey', '==', participantsKey));

    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        return querySnapshot.docs[0].id;
    } else {
        return this.createChat(participants);
    }
  }

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

  getChats(userId: string): Observable<any[]> {
    const chatsRef = collection(this.db, 'chats');
    const userChatsQuery = query(chatsRef, where('participants', 'array-contains', userId));

    return new Observable(observer => {
      const unsubscribe = onSnapshot(userChatsQuery, async (snapshot) => {
        const chats = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data() as Chat,
        }));

        const chatsWithDetails = await Promise.all(chats.map(async (chat) => {
          const otherUserId = chat.participants.find(uid => uid !== userId);

          if (otherUserId) {
            try {
              const userDetails = await this.usuarioService.getUsuario(otherUserId).toPromise();
              return { ...chat, otherParticipantDetails: userDetails || null };
            } catch (error) {
              console.error('Erro ao buscar detalhes do usuário:', error);
              return { ...chat, otherParticipantDetails: null }; // Em caso de falha, retorna os detalhes do chat sem os detalhes do usuário
            }
          } else {
            return { ...chat, otherParticipantDetails: null }; // Caso não exista outro usuário, retorna o chat sem detalhes adicionais
          }
        }));

        observer.next(chatsWithDetails);
      }, error => observer.error(error));

      return () => unsubscribe();
    });
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

  getMessages(chatId: string, lastMessageTimestamp?: Timestamp, realtime: boolean = false): Observable<Message[]> {
    const messagesRef = collection(this.db, `chats/${chatId}/messages`);
    let messageQuery: Query<DocumentData>;

    if (lastMessageTimestamp) {
      messageQuery = query(messagesRef, orderBy('timestamp', 'asc'), startAfter(lastMessageTimestamp));
    } else {
      messageQuery = query(messagesRef, orderBy('timestamp', 'asc'));
    }

    if (realtime) {
      return new Observable(observer => {
        const unsubscribe = onSnapshot(messageQuery, (snapshot: QuerySnapshot<DocumentData>) => {
          const messages = snapshot.docs.map(doc => doc.data() as Message);
          observer.next(messages);
        }, observer.error);

        return { unsubscribe };
      });
    } else {
      return from(getDocs(messageQuery)).pipe(
        map(querySnapshot => {
          return querySnapshot.docs.map(doc => doc.data() as Message);
        })
      );
    }
  }

  getChatDetails(chatId: string): Observable<Chat | undefined> {
    const chatDocRef = doc(this.db, 'chats', chatId);
    return from(getDoc(chatDocRef)).pipe(
      map(docSnapshot => docSnapshot.exists() ? docSnapshot.data() as Chat : undefined)
    );
  }
}
