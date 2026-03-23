// src/app/chat-module/chat-module-routing.module.ts
// Rotas do módulo de chat.
//
// Regra desta fase:
// - /chat                => eixo principal de conversas diretas 1:1
// - /chat/rooms          => rooms em segundo plano / compat
// - /chat/invite-list    => convites
// - /chat/:userId        => abrir fluxo direto com perfil específico
//
// Observação importante:
// - rotas estáticas DEVEM vir antes de :userId
// - caso contrário, "rooms" e "invite-list" serão tratados como userId
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { InviteListComponent } from './invite-list/invite-list.component';
import { RoomListComponent } from './rooms/room-list/room-list.component';

const routes: Routes = [
  /**
   * Entrada principal do módulo.
   * Aqui é onde "Chats" do sidebar deve cair.
   */
  {
    path: '',
    component: ChatModuleLayoutComponent,
  },

  /**
   * Rooms ficam suportadas, mas em segundo plano.
   * Mantido separado para evolução/descontinuação futura sem misturar com o 1:1.
   */
  {
    path: 'rooms',
    component: RoomListComponent,
  },

  /**
   * Lista de convites.
   */
  {
    path: 'invite-list',
    component: InviteListComponent,
  },

  /**
   * Abertura de conversa direta com outro perfil.
   * Ex.: /chat/UID_DO_OUTRO_USUARIO
   */
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
