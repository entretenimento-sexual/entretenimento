// src/app/core/navigation/authenticated-navigation.service.ts
// ============================================================================
// AUTHENTICATED NAVIGATION SERVICE
//
// Responsabilidade:
// - centralizar a definição dos links de navegação autenticada
// - derivar o estado mínimo necessário para sidebars/menus autenticados
// - permitir reaproveitamento progressivo em:
//   1) UserProfileSidebarComponent
//   2) LinksInteractionComponent
//   3) DashboardLayoutComponent
//
// Objetivo arquitetural:
// - começar a migração para um menu autenticado unificado
// - sem trocar toda a estrutura do app agora
// - sem forçar shell global neste momento
//
// Importante:
// - este service NÃO decide guards
// - este service NÃO altera sessão
// - este service NÃO faz side-effects de auth
// - ele apenas organiza estado de navegação autenticada
// ============================================================================

import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { combineLatest, Observable } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
} from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

export type AuthenticatedNavItem = {
  id: string;
  label: string;
  ariaLabel?: string;
  iconClass?: string;
  routerLink: any[];
  activeExact?: boolean;
};

export type AuthenticatedNavigationVm = {
  ready: boolean;
  uid: string | null;
  usuario: IUserDados | null;
  currentUrl: string;
  viewedUid: string | null;
  isProfileRoute: boolean;
  isOwnProfileRoute: boolean;
};

@Injectable({ providedIn: 'root' })
export class AuthenticatedNavigationService {
  private readonly router = inject(Router);
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);

  /**
   * URL atual normalizada.
   * - útil para decidir quando esconder "Meu perfil" apenas no próprio perfil
   * - futura base para evolução de menu global autenticado
   */
  private readonly currentUrl$: Observable<string> = this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => event.urlAfterRedirects),
    startWith(this.router.url),
    map((url) => this.normalizeUrl(url)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * VM compartilhado de navegação autenticada.
   *
   * Regras:
   * - uid vem da sessão
   * - usuario vem do CurrentUserStore, mas só é aceito se bater com o uid atual
   * - viewedUid é derivado da rota /perfil/:uid quando aplicável
   */
  readonly vm$: Observable<AuthenticatedNavigationVm> = combineLatest([
    this.session.ready$,
    this.session.uid$,
    this.currentUserStore.user$,
    this.currentUrl$,
  ]).pipe(
    map(([ready, uid, usuario, currentUrl]) => {
      const safeUid = uid?.trim() || null;
      const safeUsuario =
        safeUid && usuario?.uid === safeUid ? usuario : null;

      const isProfileRoute =
        currentUrl === '/perfil' || currentUrl.startsWith('/perfil/');

      const viewedUid = this.extractViewedUid(currentUrl) ?? safeUid;

      const isOwnProfileRoute =
        !!safeUid &&
        !!viewedUid &&
        safeUid === viewedUid &&
        isProfileRoute;

      return {
        ready,
        uid: safeUid,
        usuario: safeUsuario,
        currentUrl,
        viewedUid,
        isProfileRoute,
        isOwnProfileRoute,
      };
    }),
    distinctUntilChanged((a, b) =>
      a.ready === b.ready &&
      a.uid === b.uid &&
      a.currentUrl === b.currentUrl &&
      a.viewedUid === b.viewedUid &&
      a.isProfileRoute === b.isProfileRoute &&
      a.isOwnProfileRoute === b.isOwnProfileRoute &&
      (a.usuario?.uid ?? null) === (b.usuario?.uid ?? null) &&
      (a.usuario?.nickname ?? null) === (b.usuario?.nickname ?? null) &&
      (a.usuario?.photoURL ?? null) === (b.usuario?.photoURL ?? null)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Itens do menu autenticado.
   *
   * Observação:
   * - esta lista já nasce reutilizável
   * - depois ela pode ser consumida por LinksInteraction e DashboardLayout
   */
  readonly items$: Observable<AuthenticatedNavItem[]> = this.vm$.pipe(
    map((vm) => this.buildItems(vm)),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ==========================================================================
  // Helpers internos
  // ==========================================================================

  private normalizeUrl(url: string | null | undefined): string {
    return String(url ?? '')
      .split('?')[0]
      .split('#')[0]
      .trim();
  }

  private extractViewedUid(url: string): string | null {
    const parts = url.split('/').filter(Boolean);

    // /perfil/:uid
    if (parts[0] !== 'perfil') return null;
    return parts[1] ?? null;
  }

  private buildItems(vm: AuthenticatedNavigationVm): AuthenticatedNavItem[] {
    if (!vm.uid) return [];

    const items: AuthenticatedNavItem[] = [
      // Só escondemos "Meu perfil" quando já estamos no próprio perfil.
      // Em /friends/list, /dashboard etc. ele continua aparecendo.
      ...(!vm.isOwnProfileRoute
        ? [
            {
              id: 'my-profile',
              label: 'Meu perfil',
              ariaLabel: 'Ir para meu perfil',
              iconClass: 'fas fa-user',
              routerLink: ['/perfil', vm.uid],
              activeExact: true,
            },
          ]
        : []),

      {
        id: 'nearby',
        label: 'Perfis próximos',
        ariaLabel: 'Ir para perfis próximos',
        iconClass: 'fas fa-map-marker-alt',
        routerLink: ['/layout/perfis-proximos'],
        activeExact: true,
      },
      {
        id: 'photos',
        label: 'Minhas fotos',
        ariaLabel: 'Ir para minhas fotos',
        iconClass: 'fas fa-images',
        routerLink: ['/perfil', vm.uid, 'fotos'],
        activeExact: true,
      },
      {
        id: 'preferences',
        label: 'Minhas preferências',
        ariaLabel: 'Ir para minhas preferências',
        iconClass: 'fas fa-cogs',
        routerLink: ['/perfil', vm.uid, 'edit-profile-preferences'],
        activeExact: true,
      },
      {
        id: 'friends',
        label: 'Meus amigos',
        ariaLabel: 'Ir para meus amigos',
        iconClass: 'fas fa-users',
        routerLink: ['/friends', 'list'],
        activeExact: false,
      },
      {
        id: 'favorites',
        label: 'Meus favoritos',
        ariaLabel: 'Ir para meus favoritos',
        iconClass: 'fas fa-star',
        routerLink: ['/favoritos'],
        activeExact: false,
      },
      {
        id: 'chat',
        label: 'Bate-papo',
        ariaLabel: 'Ir para bate-papo',
        iconClass: 'fas fa-comments',
        routerLink: ['/chat'],
        activeExact: false,
      },
    ];

    return items;
  }
}
