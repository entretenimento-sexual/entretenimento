// src/app/chat-module/chat-module-routing.module.ts
// -----------------------------------------------------------------------------
// CHAT MODULE ROUTING
// -----------------------------------------------------------------------------
//
// Rotas do domínio de conversas.
//
// Definição canônica de Sala:
// - espaço de conversa em tempo real, público ou privado;
// - pode ser temporário ou permanente;
// - pode ser independente ou vinculado a um Local ou Comunidade;
// - não é um Local físico e não é uma Comunidade de membros.
//
// Organização atual:
// - /chat             => mensagens diretas 1:1;
// - /chat/rooms       => salas de conversa;
// - /chat/invite-list => convites;
// - /chat/:userId     => conversa direta com perfil específico.
//
// Regra importante:
// - rotas estáticas devem permanecer antes de `:userId`;
// - caso contrário, "rooms" e "invite-list" seriam interpretados como UID.
//
// Correção preservada:
// - `/chat/rooms` renderiza `ChatRoomsComponent`, que contém o fluxo funcional
//   de listagem/criação de salas;
// - `RoomListComponent` não é usado nesta rota porque é apenas placeholder.

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { ChatRoomsComponent } from './chat-rooms/chat-rooms.component';
import { InviteListComponent } from './invite-list/invite-list.component';

const routes: Routes = [
  /**
   * Entrada principal do módulo.
   * O item "Mensagens" do sidebar direciona para esta tela.
   */
  {
    path: '',
    component: ChatModuleLayoutComponent,
  },

  /**
   * Tela funcional de Salas.
   *
   * A criação da Sala ocorre exclusivamente no ChatRoomsComponent:
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
