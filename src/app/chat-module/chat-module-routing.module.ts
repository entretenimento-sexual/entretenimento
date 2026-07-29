// src/app/chat-module/chat-module-routing.module.ts
// -----------------------------------------------------------------------------
// CHAT MODULE ROUTING
// -----------------------------------------------------------------------------
// Rotas estáticas permanecem antes de `:userId`.
// `/chat/room-invites` é a rota canônica de convites para salas.
// `/chat/invite-list` permanece somente como redirecionamento legado.
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
    path: 'room-invites',
    component: InviteListComponent,
  },
  {
    path: 'invite-list',
    redirectTo: 'room-invites',
    pathMatch: 'full',
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
