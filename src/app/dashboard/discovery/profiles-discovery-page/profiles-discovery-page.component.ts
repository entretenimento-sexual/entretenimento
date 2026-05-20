// src/app/dashboard/discovery/profiles-discovery-page/profiles-discovery-page.component.ts
// -----------------------------------------------------------------------------
// ProfilesDiscoveryPageComponent
// -----------------------------------------------------------------------------
//
// Página pai da descoberta de perfis.
//
// Objetivo desta revisão:
// - remover cabeçalho visual excessivo;
// - deixar "Todos" como modo padrão;
// - manter barra compacta de modos no topo;
// - separar claramente:
//   1) Todos: feed geral/refinado, sem exigir localização;
//   2) Online: fluxo atual baseado nos usuários online;
// - preparar a evolução para Região, Recentes, Bombando e Compatíveis.
//
// Supressão explícita nesta revisão:
// - título visual grande "Explorar perfis";
// - subtítulo explicativo redundante;
// - botão "Voltar" interno;
// - estado duplicado `mode`.
//
// Motivo:
// - a navegação global já existe no navbar/sidebar;
// - a descoberta deve parecer área principal de produto, não página institucional;
// - menos texto favorece mobile e reduz poluição visual.
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { DiscoveryPublicProfilesFacade } from '../application/discovery-public-profiles.facade';
import { OnlineUsersFullComponent } from '../../online/online-users-full/online-users-full.component';
import { PublicProfilesListComponent } from '../public-profiles-list/public-profiles-list.component';
import { DiscoveryModeTabsComponent } from '../discovery-mode-tabs/discovery-mode-tabs.component';

import {
  DEFAULT_DISCOVERY_MODE,
  DISCOVERY_MODE_TABS,
  DiscoveryMode,
  DiscoveryModeTab,
  normalizeDiscoveryMode,
} from '../models/discovery-mode.model';

@Component({
  selector: 'app-profiles-discovery-page',
  standalone: true,
  imports: [
    CommonModule,
    DiscoveryModeTabsComponent,
    OnlineUsersFullComponent,
    PublicProfilesListComponent,
  ],
  templateUrl: './profiles-discovery-page.component.html',
  styleUrl: './profiles-discovery-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilesDiscoveryPageComponent {
  readonly publicProfilesFacade = inject(DiscoveryPublicProfilesFacade);
  readonly tabs: readonly DiscoveryModeTab[] = DISCOVERY_MODE_TABS;

  /**
   * "Todos" é o modo padrão.
   *
   * Importante:
   * - não deve exigir localização;
   * - deve evoluir para feed refinado;
   * - online, distância e compatibilidade entram como ranking, não como bloqueio.
   */
  readonly activeMode = signal<DiscoveryMode>(DEFAULT_DISCOVERY_MODE);

  onDiscoveryModeChange(mode: DiscoveryMode): void {
    this.activeMode.set(normalizeDiscoveryMode(mode));
  }
}