// src/app/dashboard/discovery/profiles-discovery-page/profiles-discovery-page.component.ts
// -----------------------------------------------------------------------------
// ProfilesDiscoveryPageComponent
// -----------------------------------------------------------------------------
//
// Página pai da descoberta de perfis.
//
// Responsabilidades:
// - controlar o modo ativo de descoberta;
// - compor os blocos da tela;
// - renderizar a listagem correta para cada modo;
// - manter OnlineUsersComponent especializado apenas em perfis online.
//
// Separação atual:
// - DiscoveryModeTabsComponent controla apenas as abas;
// - OnlineUsersComponent continua cuidando apenas do modo Online;
// - PublicProfilesListComponent renderiza o modo Todos;
// - a busca real de public_profiles ainda será ligada por service/facade.

import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { OnlineUsersComponent } from '../../online/online-users/online-users.component';
import { DiscoveryModeTabsComponent } from '../discovery-mode-tabs/discovery-mode-tabs.component';
import { PublicProfilesListComponent } from '../public-profiles-list/public-profiles-list.component';

import {
  DiscoveryMode,
  DiscoveryTab,
} from '../models/discovery-mode.model';

import { PublicProfileCard } from '../models/public-profile-card.model';

@Component({
  selector: 'app-profiles-discovery-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    OnlineUsersComponent,
    DiscoveryModeTabsComponent,
    PublicProfilesListComponent,
  ],
  templateUrl: './profiles-discovery-page.component.html',
  styleUrls: ['./profiles-discovery-page.component.css'],
})
export class ProfilesDiscoveryPageComponent {
  readonly mode = signal<DiscoveryMode>('online');

  /**
   * Estado provisório do modo "Todos".
   * Na próxima etapa, isso deve vir de uma facade/service de discovery.
   */
  readonly publicProfiles: readonly PublicProfileCard[] = [];
  readonly publicProfilesLoading = false;
  readonly publicProfilesError: string | null = null;

  readonly tabs: readonly DiscoveryTab[] = [
    {
      mode: 'online',
      label: 'Online',
      icon: 'fas fa-bolt',
      enabled: true,
      description: 'Perfis ativos agora.',
    },
    {
      mode: 'all',
      label: 'Todos',
      icon: 'fas fa-users',
      enabled: true,
      description: 'Perfis públicos disponíveis.',
    },
    {
      mode: 'nearby',
      label: 'Perto',
      icon: 'fas fa-location-dot',
      enabled: false,
      description: 'Perfis próximos, online ou não.',
    },
    {
      mode: 'compatible',
      label: 'Compatíveis',
      icon: 'fas fa-heart',
      enabled: false,
      description: 'Perfis com maior afinidade.',
    },
    {
      mode: 'new',
      label: 'Novos',
      icon: 'fas fa-star',
      enabled: false,
      description: 'Perfis recém-chegados.',
    },
  ];

setMode(mode: DiscoveryMode): void {
  const tab = this.tabs.find((item) => item.mode === mode);

  if (!tab?.enabled) {
    return;
  }

  this.mode.set(mode);
}
}