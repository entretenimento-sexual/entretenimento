// src/app/dashboard/discovery/profiles-discovery-page/profiles-discovery-page.component.ts
// -----------------------------------------------------------------------------
// ProfilesDiscoveryPageComponent
// -----------------------------------------------------------------------------
//
// Página pai da descoberta de perfis.
//
// Responsabilidade:
// - manter "Todos" como modo padrão;
// - controlar o modo ativo da barra de descoberta;
// - renderizar apenas modos realmente disponíveis;
// - bloquear defensivamente ativação de modos desabilitados/planned;
// - manter a barra visual desacoplada da regra de busca.
//
// Observação:
// - modos futuros ficam no model, mas não entram na navegação principal enquanto
//   não tiverem entrega real.

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
  isDiscoveryModeEnabled,
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

  readonly tabs: readonly DiscoveryModeTab[] = DISCOVERY_MODE_TABS.filter(
    (tab) => !tab.disabled
  );

  /**
   * "Todos" é o modo padrão.
   *
   * Regras:
   * - não exige localização;
   * - usa public_profiles como base;
   * - score, presença, distância e região entram como enriquecimento/ranking;
   * - não deve virar lista bruta da plataforma.
   */
  readonly activeMode = signal<DiscoveryMode>(DEFAULT_DISCOVERY_MODE);

  onDiscoveryModeChange(mode: DiscoveryMode): void {
    const normalizedMode = normalizeDiscoveryMode(mode);

    if (!isDiscoveryModeEnabled(normalizedMode)) {
      return;
    }

    this.activeMode.set(normalizedMode);
  }
}
