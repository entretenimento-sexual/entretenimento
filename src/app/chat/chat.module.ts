// src\app\chat\chat.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatListComponent } from './chat-list/chat-list.component';
import { ChatRoomComponent } from './chat-room/chat-room.component';
import { ChatMessageComponent } from './chat-message/chat-message.component';
import { ChatService } from '../core/services/chat/chat.service';

@NgModule({
  declarations: [
    ChatListComponent,
    ChatRoomComponent,
    ChatMessageComponent
  ],
  imports: [
    CommonModule,
    FormsModule
  ],
  providers: [
    ChatService
  ],
  exports: [
    ChatListComponent,
    ChatRoomComponent,
    ChatMessageComponent
  ]
})
export class ChatModule { }
