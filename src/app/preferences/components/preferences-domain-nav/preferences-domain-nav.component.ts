// src/app/preferences/components/preferences-domain-nav/preferences-domain-nav.component.ts
// Navegação interna do domínio de preferências.
// Respeita o shell global e não cria layout paralelo.
// Visual clean, simplificado, em português, de fácil navegação e mobile-first.

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-preferences-domain-nav',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './preferences-domain-nav.component.html',
  styleUrl: './preferences-domain-nav.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesDomainNavComponent {
  readonly items = [
    {
      label: 'Início',
      route: '/preferencias',
      exact: true,
    },
    {
      label: 'Visão geral',
      route: '/preferencias/overview',
      exact: true,
    },
    {
      label: 'Notificações',
      route: '/preferencias/notificacoes',
      exact: true,
    },
    {
      label: 'Descoberta',
      route: '/preferencias/discovery-settings',
      exact: true,
    },
    {
      label: 'Compatibilidade',
      route: '/preferencias/match-profile',
      exact: true,
    },
  ];
}
