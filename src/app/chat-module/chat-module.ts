//src\app\chat-module\chat-module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChatModuleRoutingModule } from './chat-module-routing.module';
import { ChatListComponent } from './chat-list/chat-list.component';
import { ChatWindowComponent } from './chat-window/chat-window.component';
import { ChatMessageComponent } from './chat-message/chat-message.component';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { ChatRoomsComponent } from './chat-rooms/chat-rooms.component';


@NgModule({
  declarations: [
    ChatListComponent,
    ChatWindowComponent,
    ChatMessageComponent,
    ChatModuleLayoutComponent,
    ChatRoomsComponent

  ],
  imports: [
    CommonModule,
    ChatModuleRoutingModule,
    FormsModule,
    RouterModule
  ]
})
export class ChatModuleModule { }
