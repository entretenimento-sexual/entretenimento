// src\app\chat-module\chat-messages-list\chat-messages-list.component.ts
// Não esqueça os comentários explicativos sobre o propósito desse componente.
// - Este componente é responsável por exibir a lista de mensagens de um chat ou sala, monitorando as atualizações em tempo real.
// - Ele utiliza serviços para obter as mensagens do chat ou sala, e gerencia subscrições para evitar vazamentos de memória.
// - O componente também implementa uma funcionalidade de rolagem automática para a última mensagem, garantindo que o usuário veja as mensagens mais recentes.
import {
          ChangeDetectorRef, Component, ElementRef, OnChanges, OnDestroy,
          SimpleChanges, ViewChild,
          input
        } from '@angular/core';
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


  readonly chatId = input<string>();
  readonly type = input<'chat' | 'room'>();

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

    const chatId = this.chatId();
    const type = this.type();
    if (!chatId || !type) {
      console.log('Erro: ID do chat ou tipo é undefined.');
      return;
    }

    // cancela eventual sub anterior
    this.messagesSubscription?.unsubscribe();
    this.messages = []; // reset local

    if (type === 'chat') {
      this.messagesSubscription = this.chatService.monitorChat(chatId)
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
                await this.chatService.updateMessageStatus(this.chatId()!, msg.id!, 'read');
              }
            }

            // Atualiza a view
            this.cdRef.detectChanges();
            // Aguarda renderização e rola para o final
            setTimeout(() => this.scrollToBottom(), 0);
          },
          error: error => {
            console.log(`Erro ao carregar mensagens do chat ${this.chatId()}:`, error);
            this.errorNotifier.showError('Erro ao carregar mensagens.');
          },
        });

    } else if (type === 'room') {
      this.messagesSubscription = this.roomMessage.getRoomMessages(chatId)
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
            console.log(`Erro ao carregar mensagens da sala ${this.chatId()}:`, err);
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
/*
auth.service.ts está sendo descuntinuado.
C:.
│   auth.service.ts
│   email-input-modal.service.ts
│   login.service.spec.ts
│   login.service.ts
│   social-auth.service.spec.ts
│   social-auth.service.ts
│
├───auth
│       access-control.service.ts
│       auth-app-block.service.ts
│       auth-orchestrator.service.ts
│       auth-return-url.service.ts
│       auth-session.service.ts
│       auth.facade.ts
│       auth.types.ts
│       current-user-store.service.ts
│       logout.service.ts
│
└───register
        email-verification.service.md
        email-verification.service.ts
        pre-register.service.ts
        register.service.spec.ts
        register.service.ts
        registerServiceREADME.md

PS C:\entretenimento\src\app\core\services\autentication>
*/
