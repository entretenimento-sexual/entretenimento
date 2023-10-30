//src\app\chat-module\chat-module.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChatModuleRoutingModule } from './chat-module-routing.module';
import { ChatListComponent } from './chat-list/chat-list.component';
import { ChatWindowComponent } from './chat-window/chat-window.component';
import { ChatMessageComponent } from './chat-message/chat-message.component';
import { FormsModule } from '@angular/forms';


@NgModule({
  declarations: [
    ChatListComponent,
    ChatWindowComponent,
    ChatMessageComponent
  ],
  imports: [
    CommonModule,
    ChatModuleRoutingModule,
    FormsModule
  ]
})
export class ChatModuleModule { }
