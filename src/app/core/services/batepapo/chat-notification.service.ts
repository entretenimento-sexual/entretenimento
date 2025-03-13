//src\app\core\services\batepapo\notification.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { collection, query, where, onSnapshot, getDocs, setDoc } from '@firebase/firestore';
import { FirestoreService } from '../data-handling/firestore.service';

@Injectable({
  providedIn: 'root'
})

export class NotificationService {
  private unreadMessagesCount = new BehaviorSubject<number>(0);
  private pendingInvitesCount = new BehaviorSubject<number>(0);

  // Observables para os componentes se inscreverem
  unreadMessagesCount$ = this.unreadMessagesCount.asObservable();
  pendingInvitesCount$ = this.pendingInvitesCount.asObservable();

  constructor(private firestoreService: FirestoreService) { }

  /**
 * Atualiza a contagem de mensagens não lidas observando mudanças no Firestore
 * Lógica de coleta de dados está no ChatService
 */
  updateUnreadMessagesForUser(totalUnreadCount: number): void {
    if (this.unreadMessagesCount.getValue() !== totalUnreadCount) {
      this.unreadMessagesCount.next(totalUnreadCount);
    }
  }

  /**
   * Atualiza a contagem de mensagens não lidas.
   * Garante que o novo valor é diferente do atual antes de emitir.
   */
  updateUnreadMessages(count: number): void {
    if (this.unreadMessagesCount.getValue() !== count) {
      console.log('Atualizando mensagens não lidas para:', count);
      this.unreadMessagesCount.next(count);
    } else {
      console.log('Nenhuma alteração nas mensagens não lidas.');
    }
  }

  /** Monitora mensagens não lidas */
  monitorUnreadMessages(userId: string): void {
    console.log('Monitorando mensagens não lidas para o usuário:', userId);
    const db = this.firestoreService.getFirestoreInstance();
    const chatsRef = collection(db, 'chats');
    const userChatsQuery = query(chatsRef, where('participants', 'array-contains', userId));

    onSnapshot(userChatsQuery, (snapshot) => {
      let totalUnreadCount = 0;

      snapshot.forEach((chatDoc) => {
        const chatId = chatDoc.id;
        const messagesRef = collection(db, `chats/${chatId}/messages`);
        const unreadMessagesQuery = query(
          messagesRef,
          where('status', '==', 'sent'),
          where('senderId', '!=', userId)
        );

        getDocs(unreadMessagesQuery).then((unreadSnapshot) => {
          totalUnreadCount += unreadSnapshot.size;
          this.updateUnreadMessagesForUser(totalUnreadCount);
        });
      });
    });
  }

   /** Reseta mensagens não lidas para um chat específico */
  resetUnreadMessagesForChat(chatId: string): void {
    const db = this.firestoreService.getFirestoreInstance();
    const messagesRef = collection(db, `chats/${chatId}/messages`);

    getDocs(query(messagesRef, where('status', '==', 'sent'))).then((snapshot) => {
      snapshot.forEach((doc) => {
        setDoc(doc.ref, { status: 'read' }, { merge: true });
      });

      // Atualiza contagem geral
      this.monitorUnreadMessages(chatId);
    });
  }


  /**
   * Atualiza a contagem de convites pendentes.
   * Garante que o novo valor é diferente do atual antes de emitir.
   */
  updatePendingInvites(count: number): void {
    if (this.pendingInvitesCount.getValue() !== count) {
      this.pendingInvitesCount.next(count);
    }
  }

  /**
   * Incrementa a contagem de mensagens não lidas.
   * Útil para atualizar dinamicamente em casos de novas mensagens.
   */
  incrementUnreadMessages(): void {
    const currentCount = this.unreadMessagesCount.getValue();
    this.unreadMessagesCount.next(currentCount + 1);
  }

  /**
   * Decrementa a contagem de mensagens não lidas.
   * Útil para atualizar dinamicamente quando uma mensagem é lida.
   */
  decrementUnreadMessages(): void {
    const currentCount = this.unreadMessagesCount.getValue();
    if (currentCount > 0) {
      this.unreadMessagesCount.next(currentCount - 1);
    }
  }

  /**
   * Incrementa a contagem de convites pendentes.
   * Útil para convites enviados ou recebidos.
   */
  incrementPendingInvites(): void {
    const currentCount = this.pendingInvitesCount.getValue();
    this.pendingInvitesCount.next(currentCount + 1);
  }

  /**
   * Decrementa a contagem de convites pendentes.
   * Útil quando um convite é aceito ou recusado.
   */
  decrementPendingInvites(): void {
    const currentCount = this.pendingInvitesCount.getValue();
    if (currentCount > 0) {
      this.pendingInvitesCount.next(currentCount - 1);
    }
  }

  /**
   * Reseta a contagem de mensagens não lidas.
   * Útil ao marcar todas as mensagens como lidas.
   */
  resetUnreadMessages(): void {
    this.unreadMessagesCount.next(0);
  }

  /**
   * Reseta a contagem de convites pendentes.
   * Útil quando todos os convites são resolvidos.
   */
  resetPendingInvites(): void {
    this.pendingInvitesCount.next(0);
  }
}
