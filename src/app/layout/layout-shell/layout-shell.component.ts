// src/app/layout/layout-shell/layout-shell.component.ts
// Shell global da aplicação.
//
// Responsabilidades:
// - renderizar navbar global
// - renderizar sidebar universal quando a tela estiver em modo auth
// - renderizar o outlet principal
// - renderizar footer conforme a rota
//
// Modos do shell:
// - guest: login / register / handlers públicos
// - onboarding: welcome / finalizar-cadastro
// - auth: área interna real do produto
//
// Observação:
// - o shell não consulta Firestore diretamente
// - o shell deriva tudo reativamente a partir do SidebarService
// - o resumo visual do usuário autenticado vem do AuthenticatedNavigationService
// - isso reduz duplicidade e evita regra de rota espalhada
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, combineLatest } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, tap } from 'rxjs/operators';

import { SidebarService, SidebarVm } from '@core/services/navigation/sidebar.service';
import {
  AuthenticatedNavigationService,
  type AuthenticatedNavigationVm,
} from '@core/services/navigation/authenticated-navigation.service';
import { HeaderModule } from '../../header/header.module';
import { FooterModule } from '../../footer/footer.module';
import {
  UniversalSidebarComponent,
  type UniversalSidebarUserSummary,
} from '../../shared/components-globais/universal-sidebar/universal-sidebar.component';
import { environment } from 'src/environments/environment';

type ShellMode = 'guest' | 'onboarding' | 'auth';

interface LayoutShellVm {
  currentUrl: string;
  shellMode: ShellMode;
  showSidebar: boolean;
  showFooter: boolean;
  sidebar: SidebarVm;
  sidebarUser: UniversalSidebarUserSummary | null;
}

@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    HeaderModule,
    FooterModule,
    UniversalSidebarComponent,
  ],
  templateUrl: './layout-shell.component.html',
  styleUrls: ['./layout-shell.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutShellComponent {
  private readonly debug = !environment.production;

  /**
   * Resumo visual do usuário autenticado para o sidebar universal.
   *
   * Observação:
   * - mantido fora do SidebarVm para não misturar
   *   estado estrutural de navegação com identidade visual do usuário.
   */
  readonly sidebarUser$: Observable<UniversalSidebarUserSummary | null> =
    this.authenticatedNavigation.vm$.pipe(
      map((navVm: AuthenticatedNavigationVm): UniversalSidebarUserSummary | null => {
        if (!navVm.uid || !navVm.usuario) {
          return null;
        }

        return {
          uid: navVm.uid,
          displayName: navVm.usuario.nickname?.trim() || 'Meu perfil',
          email: navVm.usuario.email?.trim() || null,
          subtitle: navVm.usuario.role
            ? `Conta ${String(navVm.usuario.role)}`
            : null,
          photoURL: navVm.usuario.photoURL?.trim() || null,
          profileRoute: ['/perfil', navVm.uid],
        };
      }),
      distinctUntilChanged((a, b) =>
        (a?.uid ?? null) === (b?.uid ?? null) &&
        (a?.displayName ?? null) === (b?.displayName ?? null) &&
        (a?.email ?? null) === (b?.email ?? null) &&
        (a?.subtitle ?? null) === (b?.subtitle ?? null) &&
        (a?.photoURL ?? null) === (b?.photoURL ?? null) &&
        JSON.stringify(a?.profileRoute ?? null) === JSON.stringify(b?.profileRoute ?? null)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * VM único do shell.
   *
   * Vantagens:
   * - um único async no template
   * - regra de exibição centralizada
   * - menos chance de conflito entre header/sidebar/footer
   */
  readonly vm$: Observable<LayoutShellVm> = combineLatest([
    this.sidebar.vm$,
    this.sidebarUser$,
  ]).pipe(
    map(([sidebar, sidebarUser]): LayoutShellVm => {
      const currentUrl = sidebar.currentUrl;
      const shellMode = this.resolveShellMode(currentUrl);

      return {
        currentUrl,
        shellMode,
        showSidebar: shellMode === 'auth',
        showFooter: !this.shouldHideFooter(currentUrl),
        sidebar,
        sidebarUser,
      };
    }),
    distinctUntilChanged((a, b) =>
      a.currentUrl === b.currentUrl &&
      a.shellMode === b.shellMode &&
      a.showSidebar === b.showSidebar &&
      a.showFooter === b.showFooter &&
      a.sidebar.isMobile === b.sidebar.isMobile &&
      a.sidebar.isOpen === b.sidebar.isOpen &&
      a.sidebar.isCollapsed === b.sidebar.isCollapsed &&
      a.sidebar.currentSection === b.sidebar.currentSection &&
      JSON.stringify(a.sidebar.sections) === JSON.stringify(b.sidebar.sections) &&
      (a.sidebarUser?.uid ?? null) === (b.sidebarUser?.uid ?? null) &&
      (a.sidebarUser?.displayName ?? null) === (b.sidebarUser?.displayName ?? null) &&
      (a.sidebarUser?.email ?? null) === (b.sidebarUser?.email ?? null) &&
      (a.sidebarUser?.subtitle ?? null) === (b.sidebarUser?.subtitle ?? null) &&
      (a.sidebarUser?.photoURL ?? null) === (b.sidebarUser?.photoURL ?? null) &&
      JSON.stringify(a.sidebarUser?.profileRoute ?? null) === JSON.stringify(b.sidebarUser?.profileRoute ?? null)
    ),
    tap((vm) => {
      if (!this.debug) return;
      // eslint-disable-next-line no-console
      console.log('[LayoutShell] vm$', vm);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly sidebar: SidebarService,
    private readonly authenticatedNavigation: AuthenticatedNavigationService
  ) {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log('[LayoutShell] constructor');
    }
  }

  onToggleSidebar(): void {
    this.sidebar.toggle();
  }

  onToggleCollapse(): void {
    this.sidebar.toggleCollapse();
  }

  /**
   * Define o modo visual do shell.
   *
   * Ordem importa:
   * - welcome/finalizar-cadastro vêm antes do matcher amplo de /register
   */
  private resolveShellMode(url: string): ShellMode {
    const clean = this.normalizeUrl(url);

    if (
      clean === '/register/welcome' ||
      clean === '/register/finalizar-cadastro'
    ) {
      return 'onboarding';
    }

    if (
      /^\/login(\/|$)/.test(clean) ||
      /^\/register(\/|$)/.test(clean) ||
      /^\/post-verification\/action(\/|$)/.test(clean) ||
      /^\/__\/auth\/action(\/|$)/.test(clean)
    ) {
      return 'guest';
    }

    return 'auth';
  }

  /**
   * Footer continua amplo por padrão.
   * Hoje só escondemos em chat, que tende a exigir foco total.
   */
  private shouldHideFooter(url: string): boolean {
    const clean = this.normalizeUrl(url);
    return /^\/chat(\/|$)/.test(clean);
  }

  private normalizeUrl(url: string | null | undefined): string {
    return (url ?? '').trim().split('?')[0].split('#')[0];
  }
}
