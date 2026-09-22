// src/app/chat-module/chat-module-routing.module.ts
// -----------------------------------------------------------------------------
// CHAT MODULE ROUTING
// -----------------------------------------------------------------------------
// Rotas estáticas permanecem antes de `:userId`.
//
// DIREÇÃO DE PRODUTO — /chat/rooms É A ÚNICA SUPERFÍCIE LEGADA DE SALAS
// -----------------------------------------------------------------------------
// Salas independentes estão congeladas. `/chat/rooms` existe somente enquanto
// houver registros históricos que precisem de consulta ou encerramento seguro.
// Não reintroduzir criação, convites, conversa, discovery, membership, papéis ou
// monetização de Sala. A interação coletiva canônica pertence a Comunidades;
// o chat pessoa-a-pessoa continua separado.
//
// A remoção definitiva de `/chat/rooms` deve acontecer somente depois da
// migração ou expiração do legado persistido.
// -----------------------------------------------------------------------------
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { ChatRoomsComponent } from './chat-rooms/chat-rooms.component';

export const CHAT_ROUTES: Routes = [
  {
    path: '',
    component: ChatModuleLayoutComponent,
  },
  {
    path: 'rooms',
    component: ChatRoomsComponent,
  },
  {
    path: ':userId',
    component: ChatModuleLayoutComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(CHAT_ROUTES)],
  exports: [RouterModule],
})
export class ChatModuleRoutingModule {}
