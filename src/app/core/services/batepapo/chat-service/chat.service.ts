// src\app\core\services\chat.service.ts
// Serviço de Bate-Papo usando Firestore
// Não esquecer os comentários
// AuthService está sendo descontinuado, mas mantido aqui para compatibilidade (ajustar quando possível)
import { Injectable } from '@angular/core';
import { collection, addDoc, doc, Timestamp, setDoc, deleteDoc, orderBy, startAfter,
         onSnapshot, getDocs, where, query,
         limit,
         getDoc} from 'firebase/firestore';
import { Observable, Subject, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, takeUntil } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { IChat } from '../../../interfaces/interfaces-chat/chat.interface';
import { Message } from '../../../interfaces/interfaces-chat/message.interface';
import { addMessage,  createChat,  deleteChat as deleteChat, deleteMessage as deleteMessage,
         updateChat } from 'src/app/store/actions/actions.chat/chat.actions';
import { AppState } from 'src/app/store/states/app.state';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { AuthService } from '../../autentication/auth.service';
import { FirestoreService } from '../../data-handling/legacy/firestore.service';
import { FirestoreUserQueryService } from '../../data-handling/firestore-user-query.service';
import { CacheService } from '../../general/cache/cache.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
    private destroy$ = new Subject<void>();

  constructor(private authService: AuthService,
              private firestoreUserQuery: FirestoreUserQueryService,
              private errorNotifier: ErrorNotificationService,
              private cacheService: CacheService,
              private firestoreService: FirestoreService,
              private store: Store<AppState>
            ) { }

  private handleError(action: string, error: any): Observable<never> {
    this.errorNotifier.showError(`Erro ao ${action}.`);
    console.log(`Erro ao ${action}:`, error);
    return throwError(() => new Error(`Erro ao ${action}: ${error.message}`));
  }

  /** Método para obter ou criar ID do chat */
  getOrCreateChatId(participants: string[]): Observable<string> {
    const participantsKey = participants.sort().join('_');

    return this.cacheService.get<string>(`chatId:${participantsKey}`).pipe(
      switchMap(cachedChatId => {
        if (cachedChatId) {
          return of(cachedChatId);
        }

        const db = this.firestoreService.getFirestoreInstance();
        const chatsRef = collection(db, 'chats');
        const chatQuery = query(chatsRef, where('participantsKey', '==', participantsKey));

        return from(getDocs(chatQuery)).pipe(
          switchMap((querySnapshot) => {
            if (!querySnapshot.empty) {
              const existingChatId = querySnapshot.docs[0].id;
              this.cacheService.set(`chatId:${participantsKey}`, existingChatId);
              return of(existingChatId);
            } else {
              return this.createChat(participants).pipe(
                map(newChatId => {
                  this.cacheService.set(`chatId:${participantsKey}`, newChatId);
                  return newChatId;
                })
              );
            }
          })
        );
      }),
      catchError(error => this.handleError('buscar ou criar chat', error))
    );
  }

  /** Criação de novo chat */
  createChat(participants: string[]): Observable<string> {
    const chatData: IChat = { participants, participantsKey: participants.sort().join('_'), timestamp: Timestamp.now() };
    const db = this.firestoreService.getFirestoreInstance();
    return from(addDoc(collection(db, 'chats'), chatData)).pipe(
      map(chatDocRef => {
        this.store.dispatch(createChat({ chat: { ...chatData, id: chatDocRef.id } }));
        return chatDocRef.id;
      }),
      catchError(error => this.handleError('criar chat', error))
    );
  }

  /** Buscar e persistir detalhes do outro participante */
  fetchAndPersistParticipantDetails(chatId: string, participantUid: string): Observable<any> {
    const db = this.firestoreService.getFirestoreInstance();
    const userDocRef = doc(db, 'users', participantUid);

    return from(getDoc(userDocRef)).pipe(
      switchMap(userDoc => {
        if (userDoc.exists()) {
          const userDetails = userDoc.data() as IUserDados;
          return this.updateChat(chatId, { otherParticipantDetails: userDetails }).pipe(
            map(() => userDetails)
          );
        } else {
          return this.handleError('buscar detalhes do participante', new Error('Usuário não encontrado.'));
        }
      }),
      catchError(error => this.handleError('buscar detalhes do participante', error))
    );
  }

  /** Atualizar detalhes do participante se necessário */
  refreshParticipantDetailsIfNeeded(chatId: string): void {
    this.cacheService.get<IChat>(`chat:${chatId}`).pipe(
      switchMap(chat => {
        if (chat && !chat.otherParticipantDetails) {
          const otherParticipantUid = chat.participants.find(uid => uid !== this.authService.currentUser?.uid);
          if (otherParticipantUid) {
            return this.fetchAndPersistParticipantDetails(chatId, otherParticipantUid);
          }
        }
        return of(null);
      })
    ).subscribe();
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
    return this.firestoreUserQuery.getUser(senderId).pipe(
      switchMap(user => {
        if (!user) {
          return this.handleError('enviar mensagem', new Error('Usuário não encontrado.'));
        }

        // Atribui o nickname ao campo da mensagem
        message.nickname = user.nickname || 'Anônimo';
        message.senderId = senderId;

        // ✅ timestamp “oficial” do seu app
        message.timestamp = Timestamp.now();

        // ✅ compat para rules (opcional)
        (message as any).senderUid = senderId;
        (message as any).createdAt = message.timestamp;

        message.status = 'sent';

        // Referência para a coleção de mensagens dentro do chat
        const db = this.firestoreService.getFirestoreInstance();
        const messagesRef = collection(db, `chats/${chatId}/messages`);

        // Adiciona a mensagem ao Firestore
        return from(addDoc(messagesRef, message)).pipe(
          switchMap(messageRef => {
            // Atualiza o campo lastMessage no chat com a nova mensagem
            const chatUpdate: Partial<IChat> = {
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
  getChats(userId: string, lastChatTimestamp?: Timestamp): Observable<IChat[]> {
    const cacheKey = `chats:${userId}`;

    return this.cacheService.get<IChat[]>(cacheKey).pipe(
      switchMap(cachedChats => {
        // Se houver chats no cache e não houver scroll para buscar mais, retorna o cache
        if (cachedChats && cachedChats.length > 0 && !lastChatTimestamp) {
          console.log(`[CacheService] Chats carregados do cache para ${userId}`);
          return of(cachedChats);
        }

        console.log(`[Firestore] Buscando chats para ${userId}...`);

        const db = this.firestoreService.getFirestoreInstance();
        const chatsRef = collection(db, 'chats');

        let chatQuery = query(
          chatsRef,
          where('participants', 'array-contains', userId),
          orderBy('timestamp', 'desc'),
          limit(10)
        );

        if (lastChatTimestamp) {
          chatQuery = query(
            chatsRef,
            where('participants', 'array-contains', userId),
            orderBy('timestamp', 'desc'),
            startAfter(lastChatTimestamp),
            limit(10)
          );
        }

        return new Observable<IChat[]>(observer => {
          const unsubscribe = onSnapshot(chatQuery, async snapshot => {
            const newChats = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data() as IChat
            }));

            // Atualiza o cache evitando duplicatas
            const updatedChats = (cachedChats || []).concat(
              newChats.filter(chat =>
                !(cachedChats || []).some(cachedChat => cachedChat.id === chat.id)
              )
            );

            this.cacheService.set(cacheKey, updatedChats);
            console.log(`[CacheService] Chats armazenados no cache para ${userId}`);

            observer.next(updatedChats);
          }, error => observer.error(error));

          return () => unsubscribe();
        });
      }),
      catchError(error => this.handleError('buscar chats', error))
    );
  }


  /** Atualização de um chat específico */
  updateChat(chatId: string, updateData: Partial<IChat>): Observable<string> {
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
    let messageQuery = query(messagesRef, orderBy('timestamp', 'desc'), limit(20));

    if (lastMessageTimestamp) {
      messageQuery = query(messagesRef, orderBy('timestamp', 'desc'), startAfter(lastMessageTimestamp), limit(20));
    }

    return from(getDocs(messageQuery)).pipe(
      map(snapshot =>
        snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message)).reverse() // Inverte para exibir na ordem correta
      ),
      catchError(error => this.handleError('buscar mensagens', error))
    );
  }


  // Adiciona o método monitorChat
  monitorChat(chatId: string): Observable<Message[]> {
    const db = this.firestoreService.getFirestoreInstance();
    const messagesRef = collection(db, `chats/${chatId}/messages`);
    const orderedQuery = query(messagesRef, orderBy('timestamp', 'asc'));

    return new Observable<Message[]>(observer => {
      const messagesMap = new Map<string, Message>(); // Map para evitar duplicatas

      const unsubscribe = onSnapshot(orderedQuery, snapshot => {
        snapshot.docChanges().forEach(async change => {
          const updatedMessage = { id: change.doc.id, ...change.doc.data() } as Message;

          if (change.type === 'added' || change.type === 'modified') {
            messagesMap.set(updatedMessage.id!, updatedMessage); // Atualiza ou adiciona a mensagem

            const currentUserUid = this.authService.currentUser?.uid;
            if (updatedMessage.status === 'sent' && updatedMessage.senderId !== currentUserUid) {
              await this.updateMessageStatus(chatId, updatedMessage.id!, 'delivered');
            }
          }
        });

        observer.next(Array.from(messagesMap.values()));
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
  } // Linha 352
}
