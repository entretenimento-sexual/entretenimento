// src/app/layout/layout-shell/layout-shell.component.ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Observable, combineLatest } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, tap } from 'rxjs/operators';

import { EmailVerificationGateBannerComponent } from '../../shared/components-globais/email-verification-gate-banner/email-verification-gate-banner.component';
import { SidebarService, SidebarVm } from '@core/services/navigation/sidebar.service';
import {
  AuthenticatedNavigationService,
  type AuthenticatedNavigationVm,
} from '@core/services/navigation/authenticated-navigation.service';
import { HeaderModule } from '../../header/header.module';
import { FooterModule } from '../../footer/footer.module';
import {
  UniversalSidebarComponent,
  type UniversalSidebarQuickAction,
  type UniversalSidebarUserSummary,
} from '../../shared/components-globais/universal-sidebar/universal-sidebar.component';
import { environment } from 'src/environments/environment';

type ShellMode = 'guest' | 'onboarding' | 'auth';

interface NavbarContextAction {
  id: string;
  label: string;
  route: any[] | string;
  queryParams?: Record<string, string> | null;
  icon?: string | null;
  ariaLabel?: string | null;
  variant?: 'primary' | 'secondary' | 'ghost';
}

interface LayoutShellVm {
  currentUrl: string;
  shellMode: ShellMode;
  showSidebar: boolean;
  showFooter: boolean;
  sidebar: SidebarVm;
  sidebarUser: UniversalSidebarUserSummary | null;
  sidebarShouldOverlay: boolean;
  sidebarShouldCompact: boolean;
  navbarContextActions: NavbarContextAction[];
  sidebarQuickActions: UniversalSidebarQuickAction[];
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
    EmailVerificationGateBannerComponent,
  ],
  templateUrl: './layout-shell.component.html',
  styleUrls: ['./layout-shell.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutShellComponent {
  private readonly debug = !environment.production;

  /**
   * Faixas:
   * - <= 767.98px => overlay real
   * - 768px..991.98px => compactado
   * - >= 992px => sidebar normal ocupando espaço
   */
  private readonly mobileOverlayBreakpoint = '(max-width: 767.98px)';
  private readonly compactSidebarBreakpoint =
    '(min-width: 768px) and (max-width: 991.98px)';

  readonly navigationVm$: Observable<AuthenticatedNavigationVm> =
    this.authenticatedNavigation.vm$.pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly sidebarShouldOverlay$: Observable<boolean> =
    this.breakpointObserver.observe(this.mobileOverlayBreakpoint).pipe(
      map((state) => state.matches),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly sidebarShouldCompact$: Observable<boolean> =
    this.breakpointObserver.observe(this.compactSidebarBreakpoint).pipe(
      map((state) => state.matches),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly vm$: Observable<LayoutShellVm> = combineLatest([
    this.sidebar.vm$,
    this.navigationVm$,
    this.sidebarShouldOverlay$,
    this.sidebarShouldCompact$,
  ]).pipe(
    map(([sidebar, navVm, sidebarShouldOverlay, sidebarShouldCompact]): LayoutShellVm => {
      const currentUrl = sidebar.currentUrl;
      const shellMode = this.resolveShellMode(currentUrl);
      const sidebarUser = this.mapSidebarUser(navVm);

      const shellContextActions =
        shellMode === 'auth'
          ? this.buildShellContextActions(currentUrl, navVm)
          : [];

      return {
        currentUrl,
        shellMode,
        showSidebar: shellMode === 'auth' && !this.shouldHideSidebar(currentUrl),
        showFooter: !this.shouldHideFooter(currentUrl),
        sidebar,
        sidebarUser,
        sidebarShouldOverlay,
        sidebarShouldCompact,
        navbarContextActions: shellContextActions.slice(0, 1),
        sidebarQuickActions: shellContextActions,
      };
    }),
    distinctUntilChanged((a, b) =>
      a.currentUrl === b.currentUrl &&
      a.shellMode === b.shellMode &&
      a.showSidebar === b.showSidebar &&
      a.showFooter === b.showFooter &&
      a.sidebarShouldOverlay === b.sidebarShouldOverlay &&
      a.sidebarShouldCompact === b.sidebarShouldCompact &&
      a.sidebar.isMobile === b.sidebar.isMobile &&
      a.sidebar.isOpen === b.sidebar.isOpen &&
      a.sidebar.isCollapsed === b.sidebar.isCollapsed &&
      a.sidebar.currentSection === b.sidebar.currentSection &&
      JSON.stringify(a.sidebar.sections) === JSON.stringify(b.sidebar.sections) &&
      JSON.stringify(a.navbarContextActions) === JSON.stringify(b.navbarContextActions) &&
      JSON.stringify(a.sidebarQuickActions) === JSON.stringify(b.sidebarQuickActions) &&
      (a.sidebarUser?.uid ?? null) === (b.sidebarUser?.uid ?? null) &&
      (a.sidebarUser?.displayName ?? null) === (b.sidebarUser?.displayName ?? null) &&
      (a.sidebarUser?.email ?? null) === (b.sidebarUser?.email ?? null) &&
      (a.sidebarUser?.subtitle ?? null) === (b.sidebarUser?.subtitle ?? null) &&
      (a.sidebarUser?.photoURL ?? null) === (b.sidebarUser?.photoURL ?? null) &&
      JSON.stringify(a.sidebarUser?.profileRoute ?? null) === JSON.stringify(b.sidebarUser?.profileRoute ?? null)
    ),
    tap((vm) => {
      if (!this.debug) return;
      console.log('[LayoutShell] vm$', vm);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly sidebar: SidebarService,
    private readonly authenticatedNavigation: AuthenticatedNavigationService,
    private readonly breakpointObserver: BreakpointObserver
  ) {}

  onToggleSidebar(): void {
    this.sidebar.toggle();
  }

  onToggleCollapse(): void {
    this.sidebar.toggleCollapse();
  }

  private mapSidebarUser(
    navVm: AuthenticatedNavigationVm
  ): UniversalSidebarUserSummary | null {
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
  }

  /**
   * O shell decide ações contextuais.
   * O header e a sidebar só renderizam.
   */
  private buildShellContextActions(
    currentUrl: string,
    navVm: AuthenticatedNavigationVm
  ): UniversalSidebarQuickAction[] {
    const uid = navVm.uid?.trim() || '';
    const usuario = navVm.usuario as any | null;
    const clean = this.normalizeUrl(currentUrl);

    if (!uid || !usuario) {
      return [];
    }

    const actions: UniversalSidebarQuickAction[] = [];

    const redirectTo = this.normalizeRedirectTarget(currentUrl);
    const needsProfileCompletion = usuario.profileCompleted !== true;
    const needsEmailVerification = usuario.emailVerified !== true;

    if (needsProfileCompletion && clean !== '/register/finalizar-cadastro') {
      actions.push({
        id: 'complete-profile',
        label: 'Completar perfil',
        route: ['/register/finalizar-cadastro'],
        queryParams: {
          reason: 'profile_incomplete',
          redirectTo,
        },
        icon: '🧩',
        ariaLabel: 'Completar perfil para liberar recursos da plataforma',
        variant: 'primary',
      });
    }

    if (needsEmailVerification && clean !== '/register/welcome') {
      actions.push({
        id: 'verify-email',
        label: 'Verificar e-mail',
        route: ['/register/welcome'],
        queryParams: {
          reason: 'email_unverified',
          redirectTo,
        },
        icon: '✉️',
        ariaLabel: 'Ir para a tela de verificação de e-mail',
        variant: 'secondary',
      });
    }

    if (!clean.startsWith('/preferencias/')) {
      actions.push({
        id: 'edit-preferences',
        label: 'Editar preferências',
        route: ['/preferencias', 'editar', uid],
        icon: '⚙️',
        ariaLabel: 'Editar preferências da conta',
        variant: 'ghost',
      });
    }

    if (clean !== '/subscription-plan') {
      actions.push({
        id: 'subscription-plan',
        label: 'Ver planos',
        route: ['/subscription-plan'],
        icon: '⭐',
        ariaLabel: 'Ver planos de assinatura',
        variant: 'ghost',
      });
    }

    return actions;
  }

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

  private shouldHideSidebar(url: string): boolean {
    const clean = this.normalizeUrl(url);

    return (
      /^\/checkout(\/|$)/.test(clean) ||
      /^\/subscription-plan(\/|$)/.test(clean) ||
      /^\/billing\/return(\/|$)/.test(clean)
    );
  }

  private shouldHideFooter(url: string): boolean {
    const clean = this.normalizeUrl(url);
    return /^\/chat(\/|$)/.test(clean);
  }

  private normalizeUrl(url: string | null | undefined): string {
    return (url ?? '').trim().split('?')[0].split('#')[0];
  }

  private normalizeRedirectTarget(url: string | null | undefined): string {
    const raw = (url ?? '').trim();
    if (!raw.startsWith('/') || raw.startsWith('//')) {
      return '/dashboard/principal';
    }
    return raw;
  }
} // Linha 311