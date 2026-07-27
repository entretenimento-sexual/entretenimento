// src/app/chat-module/chat-module-routing.module.ts
// -----------------------------------------------------------------------------
// CHAT MODULE ROUTING
// -----------------------------------------------------------------------------
// Rotas estáticas permanecem antes de `:userId`.
// Convites volta a ser uma tela funcional porque aceitar/recusar agora é feito
// exclusivamente pelas callables acceptRoomInvite/declineRoomInvite.
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { ChatRoomsComponent } from './chat-rooms/chat-rooms.component';
import { InviteListComponent } from './invite-list/invite-list.component';

const routes: Routes = [
  {
    path: '',
    component: ChatModuleLayoutComponent,
  },
  {
    path: 'rooms',
    component: ChatRoomsComponent,
  },
  {
    path: 'invite-list',
    component: InviteListComponent,
  },
  {
    path: ':userId',
    component: ChatModuleLayoutComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ChatModuleRoutingModule {}
