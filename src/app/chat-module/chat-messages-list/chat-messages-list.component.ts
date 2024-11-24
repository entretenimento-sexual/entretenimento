// src\app\chat-module\chat-messages-list\chat-messages-list.component.ts
import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Subscription } from 'rxjs';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';


@Component({
    selector: 'app-chat-messages-list',
    templateUrl: './chat-messages-list.component.html',
    styleUrls: ['./chat-messages-list.component.css'],
    standalone: false
})
export class ChatMessagesListComponent implements OnChanges, OnDestroy {
  private messagesSubscription: Subscription | undefined;
  messages: Message[] = [];

  @Input() chatId: string | undefined;
  @Input() type: 'chat' | 'room' | undefined;

  constructor(private chatService: ChatService,
              private roomMessage: RoomMessagesService,
              private errorNotifier: ErrorNotificationService,
              private cdRef: ChangeDetectorRef) { }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['chatId'] && changes['chatId'].currentValue !== changes['chatId'].previousValue) ||
      (changes['type'] && changes['type'].currentValue !== changes['type'].previousValue)) {
      this.loadMessages();
    }
  }

  ngOnDestroy(): void {
    this.messagesSubscription?.unsubscribe();
  }

  private loadMessages(): void {
    if (!this.chatId || !this.type) {
      console.error('Erro: ID do chat ou da sala ou tipo é undefined.');
      return;
    }

    // Cancela qualquer assinatura anterior
    this.messagesSubscription?.unsubscribe();

    if (this.type === 'chat') {
      // Redefine as mensagens ao carregar um novo chat
      this.messages = [];
      this.messagesSubscription = this.chatService.monitorChat(this.chatId)
        .subscribe({
          next: (messages: Message[]) => {
            console.log('Mensagens recebidas para o chat:', messages);
            this.messages = messages; // Substitui as mensagens pelo novo resultado
            this.cdRef.detectChanges();
          },
          error: (error) => {
            console.error(`Erro ao carregar mensagens do chat ${this.chatId}:`, error);
          },
        });
    } else if (this.type === 'room') {
      this.messagesSubscription = this.roomMessage.getRoomMessages(this.chatId).subscribe({
        next: (messages) => this.messages = messages,
        error: (err) => this.errorNotifier.showError('Erro ao carregar mensagens.')
      });
    }
  }
}
