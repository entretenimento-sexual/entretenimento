// src/app/layout/friend-management/friend-management.module.ts
// ============================================================================
// FRIEND MANAGEMENT MODULE
//
// Responsabilidade deste módulo:
// - agrupar a área de amizades
// - registrar o roteamento interno de /friends/**
// - servir como casca modular para páginas standalone da feature
//
// Observação arquitetural:
// - As telas internas desta feature são carregadas via loadComponent.
// - Portanto, este módulo NÃO precisa declarar componentes aqui.
// - A proteção principal já ocorre no AppRoutingModule em /friends.
//
// Debug:
// - Mantemos log leve apenas em desenvolvimento.
// - O objetivo é ajudar a confirmar que o módulo lazy foi carregado,
//   sem poluir produção.
// ============================================================================
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { FriendManagementRoutingModule } from './friend-management-routing.module';
import { environment } from 'src/environments/environment';

@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    FriendManagementRoutingModule,
  ],
})
export class FriendManagementModule {
  constructor() {
    if (!environment.production) {
      try {
        (window as any)?.DBG?.('[FriendManagementModule] lazy module carregado');
      } catch {
        // noop
      }
    }
  }
}
