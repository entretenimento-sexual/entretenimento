//src\app\chat-module\chat-list\chat-list.component.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css']
})
export class ChatListComponent {
  chats: { id: number, lastMessage: { content: string } }[] = [];
}
