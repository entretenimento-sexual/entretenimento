// src/app/shared/components-globais/mobile-bottom-nav/mobile-bottom-nav.component.ts
// -----------------------------------------------------------------------------
// MOBILE BOTTOM NAV
// -----------------------------------------------------------------------------
// Navegação principal inferior para mobile.
//
// Decisões:
// - componente standalone e sem side-effects;
// - recebe a URL atual do LayoutShell;
// - não substitui a sidebar universal no desktop;
// - fica oculto em chat para não competir com teclado/thread;
// - reduz a navegação fixa para quatro áreas mentais: Hoje, Descobrir, Chat e Perfil;
// - mantém rotas existentes para não quebrar deep links ou guards.
// -----------------------------------------------------------------------------

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface MobileBottomNavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly route: any[];
  readonly activePrefixes: readonly string[];
  readonly exact?: boolean;
  readonly ariaLabel: string;
  readonly badgeCount?: number | null;
}

@Component({
  selector: 'app-mobile-bottom-nav',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './mobile-bottom-nav.component.html',
  styleUrls: ['./mobile-bottom-nav.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileBottomNavComponent {
  @Input() currentUrl = '/';

  /**
   * Entrada preservada para compatibilidade com o LayoutShell atual.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - a badge de solicitações saiu da bottom nav.
   *
   * Motivo:
   * - Conexões deixou de ser destino fixo principal no mobile.
   * - solicitações passam a ser ação contextual dentro de Chat/Perfil.
   */
  @Input() friendRequestsCount = 0;

  readonly items: MobileBottomNavItem[] = [
    {
      id: 'today',
      label: 'Hoje',
      icon: '🏠',
      route: ['/dashboard', 'principal'],
      activePrefixes: ['/dashboard/principal', '/principal'],
      exact: true,
      ariaLabel: 'Ir para Hoje',
    },
    {
      id: 'discover',
      label: 'Descobrir',
      icon: '✨',
      route: ['/dashboard', 'explorar'],
      activePrefixes: [
        '/dashboard/explorar',
        '/descobrir',
        '/outro-perfil',
        '/profile-list',
        '/perfis-proximos',
        '/dashboard/online',
        '/dashboard/online-users',
      ],
      ariaLabel: 'Descobrir perfis, status e recomendações',
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: '💬',
      route: ['/chat'],
      activePrefixes: ['/chat', '/friends'],
      ariaLabel: 'Abrir conversas, convites e conexões',
    },
    {
      id: 'profile',
      label: 'Perfil',
      icon: '🙍',
      route: ['/perfil'],
      activePrefixes: ['/perfil', '/preferencias', '/conta', '/subscription-plan'],
      ariaLabel: 'Abrir perfil, preferências e conta',
    },
  ];

  isActive(item: MobileBottomNavItem): boolean {
    const clean = this.normalizeUrl(this.currentUrl);

    if (item.exact) {
      return item.activePrefixes.some((prefix) => clean === prefix);
    }

    return item.activePrefixes.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
  }

  trackById(_index: number, item: MobileBottomNavItem): string {
    return item.id;
  }

  formatBadge(count: number | null | undefined): string | null {
    const safeCount = this.normalizeBadgeCount(count);
    return safeCount > 0 ? (safeCount > 99 ? '99+' : String(safeCount)) : null;
  }

  private normalizeBadgeCount(count: unknown): number {
    const safeCount = Number(count ?? 0);

    if (!Number.isFinite(safeCount) || safeCount <= 0) {
      return 0;
    }

    return Math.floor(safeCount);
  }

  private normalizeUrl(url: string | null | undefined): string {
    return String(url ?? '').trim().split('?')[0].split('#')[0] || '/';
  }
}
