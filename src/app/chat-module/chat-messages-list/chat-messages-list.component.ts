// src\app\chat-module\chat-messages-list\chat-messages-list.component.ts
import { Component, Input, OnInit } from '@angular/core';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import { Message } from 'src/app/core/interfaces/message.interface';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat-messages-list',
  templateUrl: './chat-messages-list.component.html',
  styleUrls: ['./chat-messages-list.component.css']
})
export class ChatMessagesListComponent implements OnInit {
  private _chatId: string | undefined;
  private messagesSubscription: Subscription | undefined;
  messages: Message[] = [];

  constructor(private chatService: ChatService) { }

  @Input()
  set chatId(value: string | undefined) {
    this._chatId = value;
    this.loadMessages();
  }

  get chatId(): string | undefined {
    return this._chatId;
  }

  ngOnInit(): void {
  }

  ngOnDestroy(): void {
    // Desinscrever para evitar vazamentos de memória
    if (this.messagesSubscription) {
      this.messagesSubscription.unsubscribe();
    }
  }

  private loadMessages() {
    if (this._chatId) {
      // Desinscrever da inscrição anterior, se existir
      if (this.messagesSubscription) {
        this.messagesSubscription.unsubscribe();
      }

      this.messagesSubscription = this.chatService.getMessages(this._chatId, 10, undefined, true)
        .subscribe(messages => {
          this.messages = messages;
        });
  }

}
}
