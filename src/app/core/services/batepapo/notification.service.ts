//src\app\core\services\batepapo\notification.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Message } from '../../interfaces/interfaces-chat/message.interface';
import { Invite } from '../../interfaces/interfaces-chat/invite.interface';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private unreadMessagesCount = new BehaviorSubject<number>(0);
  private pendingInvitesCount = new BehaviorSubject<number>(0);

  // Observables para os componentes se inscreverem
  unreadMessagesCount$ = this.unreadMessagesCount.asObservable();
  pendingInvitesCount$ = this.pendingInvitesCount.asObservable();

  // Método para atualizar a contagem de mensagens não lidas
  updateUnreadMessages(count: number): void {
    this.unreadMessagesCount.next(count);
  }

  // Método para atualizar a contagem de convites pendentes
  updatePendingInvites(count: number): void {
    this.pendingInvitesCount.next(count);
  }
}
