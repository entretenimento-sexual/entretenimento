// src\app\chat-module\chat-messages-list\chat-messages-list.component.ts
import { ChangeDetectorRef, Component, ElementRef, Input, OnChanges, OnDestroy,
          SimpleChanges, ViewChild } from '@angular/core';
import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Subscription } from 'rxjs';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';


@Component({
    selector: 'app-chat-messages-list',
    templateUrl: './chat-messages-list.component.html',
    styleUrls: ['./chat-messages-list.component.css'],
    standalone: false
})
export class ChatMessagesListComponent implements OnChanges, OnDestroy {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef<HTMLDivElement>;
  private messagesSubscription: Subscription | undefined;
  messages: Message[] = [];
  

  @Input() chatId?: string;
  @Input() type: 'chat' | 'room' | undefined;

  constructor(private authService: AuthService,
              private chatService: ChatService,
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
      console.error('Erro: ID do chat ou tipo é undefined.');
      return;
    }

    // cancela eventual sub anterior
    this.messagesSubscription?.unsubscribe();
    this.messages = []; // reset local

    if (this.type === 'chat') {
      this.messagesSubscription = this.chatService.monitorChat(this.chatId)
        .subscribe({
          next: async (messages: Message[]) => {
            // Evita duplicar mensagens
            const newMessages = messages.filter(
              newMsg => !this.messages.some(existingMsg => existingMsg.id === newMsg.id)
            );

            this.messages = [...this.messages, ...newMessages];

            // Marcar como 'read' as mensagens 'delivered' (que não são do usuário atual)
            for (const msg of newMessages) {
              if (msg.status === 'delivered' && msg.senderId !== this.authService.currentUser?.uid) {
                await this.chatService.updateMessageStatus(this.chatId!, msg.id!, 'read');
              }
            }

            // Atualiza a view
            this.cdRef.detectChanges();
            // Aguarda renderização e rola para o final
            setTimeout(() => this.scrollToBottom(), 0);
          },
          error: error => {
            console.error(`Erro ao carregar mensagens do chat ${this.chatId}:`, error);
            this.errorNotifier.showError('Erro ao carregar mensagens.');
          },
        });

    } else if (this.type === 'room') {
      this.messagesSubscription = this.roomMessage.getRoomMessages(this.chatId)
        .subscribe({
          next: (newMessages) => {
            const filteredMessages = newMessages.filter(
              newMsg => !this.messages.some(existingMsg => existingMsg.id === newMsg.id)
            );
            this.messages = [...this.messages, ...filteredMessages];

            this.cdRef.detectChanges();
            setTimeout(() => this.scrollToBottom(), 0);
          },
          error: err => {
            console.error(`Erro ao carregar mensagens da sala ${this.chatId}:`, err);
            this.errorNotifier.showError('Erro ao carregar mensagens.');
          },
        });
    }
  }

  /** Rola automaticamente para a última mensagem no contêiner. */
  private scrollToBottom(): void {
    if (!this.messagesContainer) return;

    const container = this.messagesContainer.nativeElement;
    const { scrollTop, scrollHeight, clientHeight } = container;

    // "Perto do fundo"? Defina seu threshold: por ex. 200px do fundo
    const nearBottom = (scrollHeight - scrollTop - clientHeight) < 200;

    if (nearBottom) {
      container.scrollTop = scrollHeight; // rola pro final
    }
  }
}
