// src/app/chat-module/chat-module-routing.module.ts
// -----------------------------------------------------------------------------
// CHAT MODULE ROUTING
// -----------------------------------------------------------------------------
//
// Rotas do domínio de conversas.
//
// Organização atual:
// - /chat             => conversas diretas 1:1;
// - /chat/rooms       => salas de bate-papo;
// - /chat/invite-list => convites;
// - /chat/:userId     => conversa direta com perfil específico.
//
// Regra importante:
// - rotas estáticas devem permanecer antes de `:userId`;
// - caso contrário, "rooms" e "invite-list" seriam interpretados como UID.
//
// Correção desta versão:
// - `/chat/rooms` passa a renderizar `ChatRoomsComponent`, que contém o fluxo
//   funcional de listagem/criação de salas;
// - `RoomListComponent` deixa de ser usado nesta rota porque atualmente é
//   apenas um placeholder com o texto "room-list works!".

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { ChatRoomsComponent } from './chat-rooms/chat-rooms.component';
import { InviteListComponent } from './invite-list/invite-list.component';

const routes: Routes = [
  /**
   * Entrada principal do módulo.
   * O item "Chats" do sidebar direciona para esta tela.
   */
  {
    path: '',
    component: ChatModuleLayoutComponent,
  },

  /**
   * Tela funcional de salas.
   *
   * A criação da sala ocorre exclusivamente no ChatRoomsComponent:
   * - o modal apenas coleta os dados;
   * - o UID é obtido pela sessão autenticada;
   * - a escrita no Firestore ocorre uma única vez.
   */
  {
    path: 'rooms',
    component: ChatRoomsComponent,
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
   * Esta rota deve permanecer por último.
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