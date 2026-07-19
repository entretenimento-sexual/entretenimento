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
// - /chat/invite-list => compatibilidade: redireciona para Salas;
// - /chat/:userId     => conversa direta com perfil específico.
//
// A tela legada de convites foi suprimida da navegação porque aceitar/recusar ainda
// depende de transação estrutural no navegador. A URL permanece redirecionada para
// evitar quebra de links até a migração completa para Functions.
//
// Regra importante:
// - rotas estáticas devem permanecer antes de `:userId`;
// - caso contrário, "rooms" e "invite-list" seriam interpretados como UID.
// -----------------------------------------------------------------------------

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { ChatRoomsComponent } from './chat-rooms/chat-rooms.component';

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
    redirectTo: 'rooms',
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
