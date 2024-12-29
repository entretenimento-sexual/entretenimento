// src\app\core\services\chat.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, addDoc, doc, Timestamp, setDoc, deleteDoc, orderBy, startAfter,
         onSnapshot, getDocs, where, query,
         Firestore} from 'firebase/firestore';
import { Observable, Subject, from, throwError, BehaviorSubject } from 'rxjs';
import { catchError, map, switchMap, takeUntil } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { Chat } from '../../../interfaces/interfaces-chat/chat.interface';
import { Message } from '../../../interfaces/interfaces-chat/message.interface';
import { addMessage,  createChat,  deleteChat as deleteChat, deleteMessage as deleteMessage,
         updateChat } from 'src/app/store/actions/actions.chat/chat.actions';
import { AppState } from 'src/app/store/states/app.state';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { AuthService } from '../../autentication/auth.service';
import { NotificationService } from '../notification.service';
import { FirestoreService } from '../../data-handling/firestore.service';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
    private destroy$ = new Subject<void>();


  constructor(private authService: AuthService,
              private firestoreQuery: FirestoreQueryService,
              private errorNotifier: ErrorNotificationService,
              private notificationService: NotificationService,
              private firestoreService: FirestoreService,
              private store: Store<AppState>
            ) { }

  private handleError(action: string, error: any): Observable<never> {
    this.errorNotifier.showError(`Erro ao ${action}.`);
    console.error(`Erro ao ${action}:`, error);
    return throwError(() => error);
  }

  /** Método para obter ou criar ID do chat */
  getOrCreateChatId(participants: string[]): Observable<string> {
    const participantsKey = participants.sort().join('_');
    const db = this.firestoreService.getFirestoreInstance();
    console.log('Chave de participantes gerada:', participantsKey);

    const chatsRef = collection(db, 'chats');
    const chatQuery = query(chatsRef, where('participantsKey', '==', participantsKey));

    return from(getDocs(chatQuery)).pipe(
      map((querySnapshot) => {
        if (!querySnapshot.empty) {
          const existingChatId = querySnapshot.docs[0].id;
          console.log('Chat existente encontrado com ID:', existingChatId);
          return existingChatId;
        } else {
          console.log('Nenhum chat encontrado. Criando um novo chat...');
          return null; // Indica que o chat não existe e precisa ser criado
        }
      }),
      switchMap((chatId) => {
        if (chatId) {
          // Se o chat já existir, retorna o ID existente
          return from(Promise.resolve(chatId));
        } else {
          // Se o chat não existir, cria um novo chat e retorna o Observable
          return this.createChat(participants);
        }
      }),
      catchError(error => this.handleError('buscar ou criar chat', error))
    );
  }


  /** Criação de novo chat */
  createChat(participants: string[]): Observable<string> {
    const chatData: Chat = { participants, participantsKey: participants.sort().join('_'), timestamp: Timestamp.now() };
    const db = this.firestoreService.getFirestoreInstance();
    return from(addDoc(collection(db, 'chats'), chatData)).pipe(
      map(chatDocRef => {
        this.store.dispatch(createChat({ chat: chatData }));
        return chatDocRef.id;
      }),
      catchError(error => this.handleError('criar chat', error))
    );
  }

  /** Envio de mensagens no chat */
  sendMessage(chatId: string, message: Message, senderId: string): Observable<string> {
    // Verifica se o conteúdo da mensagem é válido
    if (!message.content || !message.content.trim()) {
      return this.handleError('enviar mensagem',
                  new Error('O conteúdo da mensagem não pode ser vazio.'));
    }

    // Verifica se o senderId é válido
    if (!senderId) {
      return this.handleError('enviar mensagem', new Error('ID do remetente inválido.'));
    }

    // Busca os dados do usuário para adicionar o nickname e validações
    return this.firestoreQuery.getUser(senderId).pipe(
      switchMap(user => {
        if (!user) {
          return this.handleError('enviar mensagem', new Error('Usuário não encontrado.'));
        }

        // Atribui o nickname ao campo da mensagem
        message.nickname = user.nickname || 'Anônimo';
        message.senderId = senderId;
        message.timestamp = Timestamp.now();
        message.status = 'sent'; // Define o status inicial como 'sent'

        // Referência para a coleção de mensagens dentro do chat
        const db = this.firestoreService.getFirestoreInstance();
        const messagesRef = collection(db, `chats/${chatId}/messages`);

        // Adiciona a mensagem ao Firestore
        return from(addDoc(messagesRef, message)).pipe(
          switchMap(messageRef => {
            // Atualiza o campo lastMessage no chat com a nova mensagem
            const chatUpdate: Partial<Chat> = {
              lastMessage: {
                content: message.content,
                nickname: message.nickname,
                senderId: message.senderId,
                timestamp: message.timestamp
              }
            };

            return from(this.updateChat(chatId, chatUpdate)).pipe(
              map(() => {
                this.store.dispatch(addMessage({ chatId, message }));

                // Atualiza o status da mensagem para 'delivered' após envio bem-sucedido
                return messageRef.id;
              })
            );
          })
        );
      }),
      catchError(error => this.handleError('enviar mensagem', error))
    );
  }

  /** Carrega chats do usuário autenticado */
  getChats(userId: string): Observable<any[]> {
    const db = this.firestoreService.getFirestoreInstance();
    const chatsRef = collection(db, 'chats');
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
  updateChat(chatId: string, updateData: Partial<Chat>): Observable<string> {
    const db = this.firestoreService.getFirestoreInstance();
    const chatDocRef = doc(db, 'chats', chatId);
    return from(setDoc(chatDocRef, updateData, { merge: true })).pipe(
      map(() => {
        this.store.dispatch(updateChat({ chatId, updateData }));
        return chatId;
      }),
      catchError(error => this.handleError('atualizar chat', error))
    );
  }


  /** Deletar chat */
  deleteChat(chatId: string): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();
    return from(deleteDoc(doc(db, 'chats', chatId))).pipe(
      map(() => {
        this.store.dispatch(deleteChat({ chatId }));
      }),
      catchError(error => this.handleError('deletar chat', error))
    );
  }

  /** Deletar mensagem específica */
  deleteMessage(chatId: string, messageId: string): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();
    const messageDocRef = doc(db, `chats/${chatId}/messages`, messageId);
    return from(deleteDoc(messageDocRef)).pipe(
      map(() => {
        this.store.dispatch(deleteMessage({ chatId, messageId }));
      }),
      catchError(error => this.handleError('deletar mensagem', error))
    );
  }

  /** Busca de mensagens com carregamento incremental */
  getMessages(chatId: string, lastMessageTimestamp?: Timestamp): Observable<Message[]> {
    const db = this.firestoreService.getFirestoreInstance();
    const messagesRef = collection(db, `chats/${chatId}/messages`);
    const messageQuery = lastMessageTimestamp
      ? query(messagesRef, orderBy('timestamp'), startAfter(lastMessageTimestamp))
      : query(messagesRef, orderBy('timestamp'));

    return from(getDocs(messageQuery)).pipe(
      map(snapshot => snapshot.docs.map(doc => doc.data() as Message)),
      catchError(error => this.handleError('buscar mensagens', error))
    );
  }

  // Adiciona o método monitorChat
  monitorChat(chatId: string): Observable<Message[]> {
    const db = this.firestoreService.getFirestoreInstance();
    const messagesRef = collection(db, `chats/${chatId}/messages`);
    const orderedQuery = query(messagesRef, orderBy('timestamp', 'asc'));

    return new Observable<Message[]>(observer => {
      const messages: Message[] = [];

      const unsubscribe = onSnapshot(orderedQuery, snapshot => {
        snapshot.docChanges().forEach(async change => {
          const updatedMessage = { id: change.doc.id, ...change.doc.data() } as Message;

          if (change.type === 'added' || change.type === 'modified') {
            const index = messages.findIndex(msg => msg.id === updatedMessage.id);

            // Atualizar ou adicionar mensagem
            if (index > -1) {
              messages[index] = updatedMessage;
            } else {
              messages.push(updatedMessage);
            }

            // Atualizar status da mensagem
            const currentUserUid = this.authService.currentUser?.uid;
            if (
              updatedMessage.status === 'sent' &&
              updatedMessage.senderId !== currentUserUid
            ) {
              await this.updateMessageStatus(chatId, updatedMessage.id!, 'delivered');
            }
          }
        });

        // Ordenar pelo timestamp (caso necessário)
        messages.sort((a, b) => a.timestamp.toDate().getTime() - b.timestamp.toDate().getTime());

        // Emitir mensagens ordenadas
        observer.next([...messages]);
      });

      return () => unsubscribe();
    }).pipe(takeUntil(this.destroy$));
  }

  updateMessageStatus(chatId: string, messageId: string, status: 'sent' | 'delivered' | 'read'): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();
    const messageDocRef = doc(db, `chats/${chatId}/messages`, messageId);

    return from(setDoc(messageDocRef, { status }, { merge: true })).pipe(
      map(() => {
        console.log(`Mensagem ${messageId} atualizada para o status: ${status}`);
      }),
      catchError((error) => this.handleError('atualizar status da mensagem', error))
    );
  }
}
