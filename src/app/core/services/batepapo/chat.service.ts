// src\app\core\services\chat.service.ts
import { Injectable } from '@angular/core';
import {
  getFirestore, collection, addDoc, doc, Timestamp, setDoc, deleteDoc,
  orderBy, startAfter, onSnapshot, getDocs, where, query
} from 'firebase/firestore';
import { Observable, from } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { Chat } from '../../interfaces/interfaces-chat/chat.interface';
import { Message } from '../../interfaces/interfaces-chat/message.interface';
import { UsuarioService } from '../usuario.service';
import {
  addMessage,
  createChat,
  deleteChat as deleteChat,
  deleteMessage as deleteMessage,
  updateChat,
} from 'src/app/store/actions/actions.chat/chat.actions';
import { AppState } from 'src/app/store/states/app.state';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private db = getFirestore();

  constructor(
    private usuarioService: UsuarioService,
    private store: Store<AppState>
  ) { }

  /** Método para obter ou criar ID do chat */
  async getOrCreateChatId(participants: string[]): Promise<string> {
    const participantsKey = participants.sort().join('_');
    const chatsRef = collection(this.db, 'chats');
    const chatQuery = query(chatsRef, where('participantsKey', '==', participantsKey));
    const querySnapshot = await getDocs(chatQuery);

    if (!querySnapshot.empty) {
      return querySnapshot.docs[0].id;
    } else {
      return this.createChat(participants);
    }
  }

  /** Criação de novo chat */
  async createChat(participants: string[]): Promise<string> {
    const chatData: Chat = { participants, participantsKey: participants.sort().join('_'), timestamp: Timestamp.now() };
    try {
      const chatDocRef = await addDoc(collection(this.db, 'chats'), chatData);
      this.store.dispatch(createChat({ chat: chatData }));
      return chatDocRef.id;
    } catch (error) {
      console.error("Erro ao criar chat:", error);
      throw error;
    }
  }

  /** Envio de mensagens no chat */
  async sendMessage(chatId: string, message: Message): Promise<string> {
    try {
      const messageRef = await addDoc(collection(this.db, `chats/${chatId}/messages`), message);
      this.store.dispatch(addMessage({ chatId, message }));
      return messageRef.id;
    } catch (error) {
      console.error(`Erro ao enviar mensagem para o chatId ${chatId}:`, message, error);
      throw error;
    }
  }

  /** Carrega chats do usuário autenticado */
  getUserChats(userId: string): Observable<any[]> {
    const chatsRef = collection(this.db, 'chats');
    const userChatsQuery = query(chatsRef, where('participants', 'array-contains', userId));

    return new Observable(observer => {
      const unsubscribe = onSnapshot(userChatsQuery, async snapshot => {
        const chats = await Promise.all(snapshot.docs.map(async doc => {
          const chat = doc.data() as Chat;
          const otherUserId = chat.participants.find(uid => uid !== userId);
          console.log('Chat encontrado:', doc.id, chat);
          if (!otherUserId) return { ...chat, otherParticipantDetails: null };

          const userDetails = await this.usuarioService.getUsuario(otherUserId).toPromise();
          return { ...chat, otherParticipantDetails: userDetails || null };
        }));
        observer.next(chats);
      }, error => observer.error(error));

      return unsubscribe;
    });
  }

  /** Atualização de um chat específico */
  async updateChat(chatId: string, updateData: Partial<Chat>): Promise<string> {
    try {
      const chatDocRef = doc(this.db, 'chats', chatId);
      await setDoc(chatDocRef, updateData, { merge: true });
      this.store.dispatch(updateChat({ chatId, updateData }));
      return chatId;
    } catch (error) {
      console.error("Erro ao atualizar chat:", error);
      throw error;
    }
  }

  /** Deletar chat */
  async deleteChat(chatId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.db, 'chats', chatId));
      this.store.dispatch(deleteChat({ chatId }));
    } catch (error) {
      console.error("Erro ao deletar chat:", error);
      throw error;
    }
  }

  /** Deletar mensagem específica */
  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.db, `chats/${chatId}/messages`, messageId));
      this.store.dispatch(deleteMessage({ chatId, messageId }));
    } catch (error) {
      console.error("Erro ao deletar mensagem:", error);
      throw error;
    }
  }

  /** Busca de mensagens com carregamento incremental */
  getMessages(chatId: string, lastMessageTimestamp?: Timestamp): Observable<Message[]> {
    const messagesRef = collection(this.db, `chats/${chatId}/messages`);
    const messageQuery = lastMessageTimestamp
      ? query(messagesRef, orderBy('timestamp'), startAfter(lastMessageTimestamp))
      : query(messagesRef, orderBy('timestamp'));

    return from(getDocs(messageQuery)).pipe(
      map(snapshot => snapshot.docs.map(doc => doc.data() as Message)),
      catchError(error => {
        console.error("Erro ao buscar mensagens:", error);
        throw error;
      })
    );
  }

  // Adiciona o método monitorChat
  monitorChat(chatId: string): Observable<Message> {
    const messagesRef = collection(this.db, `chats/${chatId}/messages`);
    return new Observable(observer => {
      const unsubscribe = onSnapshot(messagesRef, snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const newMessage = change.doc.data() as Message;
            observer.next(newMessage);
          }
        });
      }, error => observer.error(error));

      // Cleanup quando o Observable é concluído
      return unsubscribe;
    });
  }

  /** Feedback visual */
  private handleFeedback(action: string, success: boolean) {
    const feedbackMessage = success
      ? `${action} realizado com sucesso`
      : `Erro ao realizar ${action}`;
    console.log(feedbackMessage);
  }
}
