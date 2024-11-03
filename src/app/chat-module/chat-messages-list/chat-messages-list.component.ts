// src\app\chat-module\chat-messages-list\chat-messages-list.component.ts
import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import { RoomService } from 'src/app/core/services/batepapo/room.service'; // Não esqueça de injetar RoomService
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat-messages-list',
  templateUrl: './chat-messages-list.component.html',
  styleUrls: ['./chat-messages-list.component.css']
})
export class ChatMessagesListComponent implements OnChanges, OnDestroy {
  private messagesSubscription: Subscription | undefined;
  messages: Message[] = [];

  @Input() chatId: string | undefined;
  @Input() type: 'chat' | 'room' | undefined;

  constructor(private chatService: ChatService,
              private roomService: RoomService,
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
    // Garante que qualquer inscrição anterior seja cancelada
    this.messagesSubscription?.unsubscribe();

    if (this.type === 'chat') {
      // Caso seja um chat, utiliza o ChatService para obter as mensagens
      this.messagesSubscription = this.chatService.monitorChat(this.chatId)
        .subscribe(message => {
          this.messages.push(message); // Adiciona a nova mensagem em tempo real
          this.cdRef.detectChanges(); // Atualiza a interface com as novas mensagens
        }, error => {
          console.error(`Erro ao carregar mensagens em tempo real do chat ${this.chatId}:`, error);
        });
    } else {
      // Caso seja uma sala, utiliza o RoomService para obter as mensagens
      this.messagesSubscription = this.roomService.getRoomMessages(this.chatId, true) // true para realtime, se aplicável
        .subscribe(messages => {
          // Não é necessário converter o timestamp aqui, pois a conversão para Date será feita na exibição
          this.messages = messages;
        }, error => {
          console.error(`Erro ao carregar mensagens da sala ${this.chatId}:`, error);
        });
    }
  }
}
