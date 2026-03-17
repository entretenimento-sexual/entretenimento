// src/app/chat-module/chat-module-routing.module.ts
// Rotas do chat direto.
//
// Observação:
// - a proteção principal já acontece no AppRouting em /chat
// - lá exigimos:
//   - auth
//   - email verified
//   - profile completed

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';

const routes: Routes = [
  {
    path: ':userId',
    component: ChatModuleLayoutComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ChatModuleRoutingModule { }
