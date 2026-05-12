// src/app/dashboard/discovery/discovery-mode-tabs/discovery-mode-tabs.component.ts
// -----------------------------------------------------------------------------
// DiscoveryModeTabsComponent
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - exibir as opções de descoberta: Online, Todos, Perto, Compatíveis e Novos;
// - emitir o modo selecionado para a página pai;
// - não consultar serviço;
// - não consultar store;
// - não decidir regra de negócio.
//
// Este componente é puramente visual/controlado por Input.
// A página pai continua sendo dona do estado selecionado.

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  DiscoveryMode,
  DiscoveryTab,
} from '../models/discovery-mode.model';

@Component({
  selector: 'app-discovery-mode-tabs',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './discovery-mode-tabs.component.html',
  styleUrls: ['./discovery-mode-tabs.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryModeTabsComponent {
  /**
   * Lista de abas recebida da página pai.
   * A página pai decide quais modos existem e quais estão habilitados.
   */
  readonly tabs = input.required<readonly DiscoveryTab[]>();

  /**
   * Modo atualmente ativo.
   */
  readonly mode = input.required<DiscoveryMode>();

  /**
   * Evento emitido quando o usuário seleciona um modo habilitado.
   */
  readonly modeChange = output<DiscoveryMode>();

  selectTab(tab: DiscoveryTab): void {
    if (!tab.enabled) {
      return;
    }

    if (tab.mode === this.mode()) {
      return;
    }

    this.modeChange.emit(tab.mode);
  }
}