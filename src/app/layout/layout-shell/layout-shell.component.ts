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
  sidebarShouldOverlay: boolean;
  sidebarShouldCompact: boolean;
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
   * - <= 767.98px  => overlay real
   * - 768px..991.98px => compactado em ícones
   * - >= 992px => sidebar normal ocupando espaço
   */
  private readonly mobileOverlayBreakpoint = '(max-width: 767.98px)';
  private readonly compactSidebarBreakpoint =
    '(min-width: 768px) and (max-width: 991.98px)';

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
    this.sidebarUser$,
    this.sidebarShouldOverlay$,
    this.sidebarShouldCompact$,
  ]).pipe(
    map(([sidebar, sidebarUser, sidebarShouldOverlay, sidebarShouldCompact]): LayoutShellVm => {
      const currentUrl = sidebar.currentUrl;
      const shellMode = this.resolveShellMode(currentUrl);

      return {
        currentUrl,
        shellMode,
        showSidebar: shellMode === 'auth' && !this.shouldHideSidebar(currentUrl),
        showFooter: !this.shouldHideFooter(currentUrl),
        sidebar,
        sidebarUser,
        sidebarShouldOverlay,
        sidebarShouldCompact,
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
} // Linha 208