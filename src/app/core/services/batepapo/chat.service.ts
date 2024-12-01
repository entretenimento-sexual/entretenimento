// src\app\core\services\chat.service.ts
import { Injectable } from '@angular/core';
import {
  getFirestore, collection, addDoc, doc, Timestamp, setDoc, deleteDoc,
  orderBy, startAfter, onSnapshot, getDocs, where, query
} from 'firebase/firestore';
import { Observable, Subject, from } from 'rxjs';
import { catchError, map, takeUntil } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { Chat } from '../../interfaces/interfaces-chat/chat.interface';
import { Message } from '../../interfaces/interfaces-chat/message.interface';
import { UsuarioService } from '../user-profile/usuario.service';
import {
  addMessage,
  createChat,
  deleteChat as deleteChat,
  deleteMessage as deleteMessage,
  updateChat,
} from 'src/app/store/actions/actions.chat/chat.actions';
import { AppState } from 'src/app/store/states/app.state';
import { FirestoreQueryService } from '../data-handling/firestore-query.service';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private db = getFirestore();
  private destroy$ = new Subject<void>();

  constructor(
    private usuarioService: UsuarioService,
    private firestoreQuery: FirestoreQueryService,
    private store: Store<AppState>
  ) { }

  /** Método para obter ou criar ID do chat */
  async getOrCreateChatId(participants: string[]): Promise<string> {
    const participantsKey = participants.sort().join('_');
    console.log('Chave de participantes gerada:', participantsKey);
    const chatsRef = collection(this.db, 'chats');
    const chatQuery = query(chatsRef, where('participantsKey', '==', participantsKey));
    const querySnapshot = await getDocs(chatQuery);

    if (!querySnapshot.empty) {
      console.log('Chat existente encontrado com ID:', querySnapshot.docs[0].id);
      return querySnapshot.docs[0].id;
    } else {
      console.log('Nenhum chat encontrado. Criando um novo chat...');
      return this.createChat(participants);
    }
  }

  /** Criação de novo chat */
  async createChat(participants: string[]): Promise<string> {
    const chatData: Chat = { participants, participantsKey: participants.sort().join('_'), timestamp: Timestamp.now() };
    console.log('Dados do chat a serem criados:', chatData);
    try {
      const chatDocRef = await addDoc(collection(this.db, 'chats'), chatData);
      console.log('Novo chat criado com ID:', chatDocRef.id);
      this.store.dispatch(createChat({ chat: chatData }));
      return chatDocRef.id;
    } catch (error) {
      console.error("Erro ao criar chat:", error);
      throw error;
    }
  }

  /** Envio de mensagens no chat */
  async sendMessage(chatId: string, message: Message): Promise<string> {
    console.log(`Enviando mensagem para o chat com ID: ${chatId}`, message);
    try {
      const messageRef = await addDoc(collection(this.db, `chats/${chatId}/messages`), message);
      console.log('Mensagem enviada com ID:', messageRef.id);
      this.store.dispatch(addMessage({ chatId, message }));
      return messageRef.id;
    } catch (error) {
      console.error(`Erro ao enviar mensagem para o chatId ${chatId}:`, message, error);
      throw error;
    }
  }

  /** Carrega chats do usuário autenticado */
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
              const userDetails = await this.firestoreQuery.getUser(otherUserId).toPromise();
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
  monitorChat(chatId: string): Observable<Message[]> {
    const messagesRef = collection(this.db, `chats/${chatId}/messages`);

    return new Observable<Message[]>(observer => {
      const messages: Message[] = []; // Acumula mensagens
      const unsubscribe = onSnapshot(messagesRef, snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const newMessage = change.doc.data() as Message;
            messages.push(newMessage);// Adiciona a nova mensagem ao array acumulado
          }
        });
        observer.next([...messages]); // Emite uma cópia do array acumulado
      }, error => observer.error(error));

      return () => unsubscribe();
    }).pipe(takeUntil(this.destroy$));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Feedback visual */
  private handleFeedback(action: string, success: boolean) {
    const feedbackMessage = success
      ? `${action} realizado com sucesso`
      : `Erro ao realizar ${action}`;
    console.log(feedbackMessage);
  }
}
