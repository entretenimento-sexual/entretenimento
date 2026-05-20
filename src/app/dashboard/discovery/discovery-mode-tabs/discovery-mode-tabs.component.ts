// src/app/dashboard/discovery/discovery-mode-tabs/discovery-mode-tabs.component.ts
// -----------------------------------------------------------------------------
// DiscoveryModeTabsComponent
// -----------------------------------------------------------------------------
//
// Barra compacta de modos de descoberta.
//
// Responsabilidade:
// - renderizar os modos;
// - emitir mudança de modo;
// - exibir tooltip acessível quando o modo precisar de explicação;
// - não consultar Firestore;
// - não decidir regra de ranking;
// - não criar layout paralelo.
//
// Observação:
// - modos desabilitados permanecem visíveis para comunicar evolução,
//   mas não são clicáveis.
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

import { CommonModule } from '@angular/common';

import {
  DiscoveryMode,
  DiscoveryModeTab,
} from '../models/discovery-mode.model';

@Component({
  selector: 'app-discovery-mode-tabs',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './discovery-mode-tabs.component.html',
  styleUrl: './discovery-mode-tabs.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryModeTabsComponent {
  readonly tabs = input.required<readonly DiscoveryModeTab[]>();
  readonly activeMode = input.required<DiscoveryMode>();

  readonly modeChange = output<DiscoveryMode>();

  selectTab(tab: DiscoveryModeTab): void {
    if (tab.disabled) return;

    this.modeChange.emit(tab.id);
  }

  tooltipId(tab: DiscoveryModeTab): string {
    return `discovery-tab-tooltip-${tab.id}`;
  }

  trackTab(_: number, tab: DiscoveryModeTab): DiscoveryMode {
    return tab.id;
  }
}