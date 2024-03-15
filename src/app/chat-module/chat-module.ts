//src\app\chat-module\chat-module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChatModuleRoutingModule } from './chat-module-routing.module';
import { ChatListComponent } from './chat-list/chat-list.component';
import { ChatWindowComponent } from './chat-window/chat-window.component';
import { ChatMessageComponent } from './chat-message/chat-message.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { ChatMessagesListComponent } from './chat-messages-list/chat-messages-list.component';
import { ChatRoomsComponent } from './chat-rooms/chat-rooms.component';
import { CreateRoomModalComponent } from './create-room-modal/create-room-modal.component';
import { MatDialogModule } from '@angular/material/dialog';

@NgModule({
  declarations: [
    ChatListComponent,
    ChatWindowComponent,
    ChatMessageComponent,
    ChatModuleLayoutComponent,
    ChatRoomsComponent,
    ChatMessagesListComponent,
    CreateRoomModalComponent
  ],

  imports: [
    CommonModule,
    MatDialogModule,
    ChatModuleRoutingModule,
    FormsModule,
    RouterModule,
    ReactiveFormsModule
  ],

})
export class ChatModuleModule { }
