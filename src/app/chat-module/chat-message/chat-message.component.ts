// src\app\chat-module\chat-message\chat-message.component.ts
import { Component, Input } from '@angular/core';
import { Message } from 'src/app/core/interfaces/message.interface';

@Component({
  selector: 'app-chat-message',
  templateUrl: './chat-message.component.html',
  styleUrls: ['./chat-message.component.css']
})
export class ChatMessageComponent {
  @Input() message!: Message;
}
