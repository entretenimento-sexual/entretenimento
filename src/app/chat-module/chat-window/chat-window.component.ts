// src/app/chat-module/chat-window/chat-window.component.ts
// Componente responsável por enviar mensagens no chat atual.
// Ajustes desta versão:
// - usa CurrentUserStoreService como fonte do usuário do app
// - mantém sendMessage()
// - evita subscribe solto
// - usa tratamento de erro com feedback ao usuário
import { Component } from '@angular/core';
import { Timestamp } from '@firebase/firestore';
import { of } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';

import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

@Component({
  selector: 'app-chat-window',
  templateUrl: './chat-window.component.html',
  styleUrls: ['./chat-window.component.css'],
  standalone: false
})
export class ChatWindowComponent {
  messages: Message[] = [];
  messageContent = '';

  constructor(
    private readonly chatService: ChatService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly errorNotifier: ErrorNotificationService
  ) { }

  /**
   * Envia a mensagem digitada pelo usuário autenticado.
   * - Usa o CurrentUserStoreService como fonte do perfil atual.
   * - Evita subscribe permanente.
   * - Mantém nomenclatura original do método.
   */
  sendMessage(): void {
    const content = this.messageContent.trim();

    if (!content) {
      return;
    }

    this.currentUserStore.user$
      .pipe(
        take(1),
        switchMap((currentUser) => {
          if (!currentUser?.uid) {
            this.errorNotifier.showWarning('Usuário não autenticado.');
            return of(null);
          }

          const newMessage: Message = {
            content,
            senderId: currentUser.uid,
            nickname: currentUser.nickname || 'Usuário',
            timestamp: Timestamp.fromDate(new Date()),
          };

          this.messages = [...this.messages, newMessage];
          this.messageContent = '';

          return this.chatService.sendMessage('chatId', newMessage, currentUser.uid).pipe(
            catchError((error) => {
              this.errorNotifier.showError('Erro ao enviar mensagem.');
              console.log('Erro ao enviar mensagem:', error);
              return of(null);
            })
          );
        }),
        catchError((error) => {
          this.errorNotifier.showError('Erro ao obter dados do usuário.');
          console.log('Erro ao obter usuário atual:', error);
          return of(null);
        })
      )
      .subscribe();
  }
}
