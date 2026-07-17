// src/app/layout/layout-shell/layout-shell.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Observable, combineLatest } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
import { MobileBottomNavComponent } from '../../shared/components-globais/mobile-bottom-nav/mobile-bottom-nav.component';
import { UserActivityHubComponent } from '../../notifications/user-activity-hub/user-activity-hub.component';

import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ChatNotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

import * as InviteActions from 'src/app/store/actions/actions.chat/invite.actions';
import { selectPendingInvitesCount } from 'src/app/store/selectors/selectors.chat/invite.selectors';
import { selectInboundRequestsCount, selectOutboundRequestsCount } from 'src/app/store/selectors/selectors.interactions/friends';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

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
  friendRequestsCount: number;

  /**
   * Modo especial do shell para chat.
   *
   * Regras:
   * - sidebar universal fica permanentemente recolhido no desktop
   * - usuário não pode expandir manualmente enquanto estiver no chat
   * - perfil/quick actions grandes saem de cena para não competir com a thread
   */
  isChatLayout: boolean;

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
    MobileBottomNavComponent,
    EmailVerificationGateBannerComponent,
    UserActivityHubComponent,
  ],
  templateUrl: './layout-shell.component.html',
  styleUrls: ['./layout-shell.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutShellComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly authSession = inject(AuthSessionService);
  private readonly chatNotification = inject(ChatNotificationService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  /**
   * Debug seguro do shell/layout autenticado.
   *
   * Canal:
   * localStorage.setItem('DEBUG_LAYOUT', '1');
   *
   * O LayoutShell pode revelar rota atual, UID, e-mail resumido do usuário
   * e modo visual do app. Por isso, não deve usar console.log direto.
   */
  private canDebug(): boolean {
    return this.privacyDebug.canLog('layout');
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('layout', `LayoutShell: ${message}`, extra);
  }

  private summarizeVmForDebug(vm: LayoutShellVm): Record<string, unknown> {
    return {
      currentUrl: vm.currentUrl,
      shellMode: vm.shellMode,
      showSidebar: vm.showSidebar,
      showFooter: vm.showFooter,
      isChatLayout: vm.isChatLayout,
      friendRequestsCount: vm.friendRequestsCount,
      sidebarShouldOverlay: vm.sidebarShouldOverlay,
      sidebarShouldCompact: vm.sidebarShouldCompact,
      sidebarCurrentSection: vm.sidebar.currentSection,
      sidebarIsMobile: vm.sidebar.isMobile,
      sidebarIsOpen: vm.sidebar.isOpen,
      sidebarIsCollapsed: vm.sidebar.isCollapsed,
      sidebarExpandedGroupIds: vm.sidebar.expandedGroupIds,
      hasSidebarUser: !!vm.sidebarUser,
      sidebarUserUid: vm.sidebarUser?.uid ?? null,
      sidebarUserHasEmail: !!vm.sidebarUser?.email,
      navbarContextActionsTotal: vm.navbarContextActions.length,
      sidebarQuickActionsTotal: vm.sidebarQuickActions.length,
    };
  }

  private readonly shellUid$ = this.authSession.uid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

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
    this.store.select(selectInboundRequestsCount).pipe(distinctUntilChanged()),
    this.store.select(selectOutboundRequestsCount).pipe(distinctUntilChanged()),
  ]).pipe(
    map(([
      sidebar,
      navVm,
      sidebarShouldOverlay,
      sidebarShouldCompact,
      inboundRequestsCount,
      outboundRequestsCount,
    ]): LayoutShellVm => {
      const currentUrl = sidebar.currentUrl;
      const shellMode = this.resolveShellMode(currentUrl);
      const sidebarUser = this.mapSidebarUser(navVm);

      /**
       * Chat mode:
       * - vale para /chat, /chat/rooms, /chat/invite-list etc.
       * - não depende de query string
       */
      const isChatLayout = /^\/chat(\/|$)/.test(this.normalizeUrl(currentUrl));
      const safeFriendRequestsCount = this.normalizeBadgeCount(
        inboundRequestsCount + outboundRequestsCount
      );
      const sidebarWithBadges = this.applySidebarBadges(
        sidebar,
        safeFriendRequestsCount
      );

      const shellContextActions =
        shellMode === 'auth'
          ? this.buildShellContextActions(
              currentUrl,
              navVm,
              safeFriendRequestsCount
            )
          : [];

      return {
        currentUrl,
        shellMode,
        showSidebar: shellMode === 'auth' && !this.shouldHideSidebar(currentUrl),
        showFooter: !this.shouldHideFooter(currentUrl),
        isChatLayout,
        sidebar: sidebarWithBadges,
        friendRequestsCount: safeFriendRequestsCount,
        sidebarUser,
        sidebarShouldOverlay,
        sidebarShouldCompact,
        navbarContextActions: shellContextActions.slice(0, 1),
        /**
         * SUPRESSÃO EXPLÍCITA:
         * - Editar preferências deixa de ser ação rápida do sidebar.
         *
         * Motivo:
         * - a mesma rota agora pertence ao submenu Conta;
         * - o atalho contextual da navbar continua disponível.
         */
        sidebarQuickActions: shellContextActions.filter(
          (action) => action.id !== 'edit-preferences'
        ),
      };
    }),
    distinctUntilChanged((a, b) =>
      a.currentUrl === b.currentUrl &&
      a.shellMode === b.shellMode &&
      a.showSidebar === b.showSidebar &&
      a.showFooter === b.showFooter &&
      a.isChatLayout === b.isChatLayout &&
      a.friendRequestsCount === b.friendRequestsCount &&
      a.sidebarShouldOverlay === b.sidebarShouldOverlay &&
      a.sidebarShouldCompact === b.sidebarShouldCompact &&
      a.sidebar.isMobile === b.sidebar.isMobile &&
      a.sidebar.isOpen === b.sidebar.isOpen &&
      a.sidebar.isCollapsed === b.sidebar.isCollapsed &&
      a.sidebar.currentSection === b.sidebar.currentSection &&
      JSON.stringify(a.sidebar.expandedGroupIds) ===
        JSON.stringify(b.sidebar.expandedGroupIds) &&
      JSON.stringify(a.sidebar.sections) === JSON.stringify(b.sidebar.sections) &&
      JSON.stringify(a.navbarContextActions) === JSON.stringify(b.navbarContextActions) &&
      JSON.stringify(a.sidebarQuickActions) === JSON.stringify(b.sidebarQuickActions) &&
      (a.sidebarUser?.uid ?? null) === (b.sidebarUser?.uid ?? null) &&
      (a.sidebarUser?.displayName ?? null) === (b.sidebarUser?.displayName ?? null) &&
      (a.sidebarUser?.email ?? null) === (b.sidebarUser?.email ?? null) &&
      (a.sidebarUser?.subtitle ?? null) === (b.sidebarUser?.subtitle ?? null) &&
      (a.sidebarUser?.photoURL ?? null) === (b.sidebarUser?.photoURL ?? null) &&
      JSON.stringify(a.sidebarUser?.profileRoute ?? null) ===
        JSON.stringify(b.sidebarUser?.profileRoute ?? null)
    ),
    tap((vm) => {
      if (!this.canDebug()) return;

      this.dbg('vm$', this.summarizeVmForDebug(vm));
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly sidebar: SidebarService,
    private readonly authenticatedNavigation: AuthenticatedNavigationService,
    private readonly breakpointObserver: BreakpointObserver
  ) {}

  ngOnInit(): void {
    this.bindGlobalSocialOwners();
    this.bindGlobalInviteBadge();
  }

  ngOnDestroy(): void {
    this.store.dispatch(InviteActions.StopInvites());
    this.chatNotification.resetPendingInvites();
  }

  onToggleSidebar(): void {
    this.sidebar.toggle();
  }

  onToggleCollapse(): void {
    this.sidebar.toggleCollapse();
  }

  onToggleSidebarGroup(groupId: string): void {
    this.sidebar.toggleGroup(groupId);
  }

  onCloseSidebarGroup(groupId: string): void {
    this.sidebar.closeGroup(groupId);
  }

  /**
   * Owner global apenas de convites.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - friends bootstrap/listeners NÃO ficam mais aqui.
   *
   * Motivo:
   * - FriendsNetworkEffects já é o owner oficial dessa feature.
   * - manter isso aqui duplicava start/stop e bootstrap.
   */
  private bindGlobalSocialOwners(): void {
    this.shellUid$
      .pipe(
        tap((uid) => {
          if (uid) {
            this.store.dispatch(InviteActions.LoadInvites({ userId: uid }));
            this.dbg('invites:start', { uid });
            return;
          }

          this.store.dispatch(InviteActions.StopInvites());
          this.chatNotification.resetPendingInvites();

          this.dbg('invites:stop');
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindGlobalInviteBadge(): void {
    this.store.select(selectPendingInvitesCount)
      .pipe(
        distinctUntilChanged(),
        tap((count) => {
          this.chatNotification.updatePendingInvites(count);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
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

  private normalizeBadgeCount(count: unknown): number {
    const safeCount = Number(count ?? 0);

    if (!Number.isFinite(safeCount) || safeCount <= 0) {
      return 0;
    }

    return Math.floor(safeCount);
  }

  private formatBadgeCount(count: number): string {
    return count > 99 ? '99+' : String(count);
  }

  private applySidebarBadges(
    sidebar: SidebarVm,
    friendRequestsCount: number
  ): SidebarVm {
    if (!friendRequestsCount) {
      return sidebar;
    }

    const badgeText = this.buildFriendRequestsBadgeLabel(friendRequestsCount);

    return {
      ...sidebar,
      sections: sidebar.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => {
          if (item.id !== 'friend-requests') {
            return item;
          }

          return {
            ...item,
            badgeCount: friendRequestsCount,
            badgeLabel: badgeText,
            ariaLabel: `Consultar solicitações de amizade. ${badgeText}.`,
          };
        }),
      })),
    };
  }

  private buildFriendRequestsBadgeLabel(count: number): string {
    const safeCount = this.normalizeBadgeCount(count);

    if (safeCount === 1) {
      return '1 solicitação de amizade pendente';
    }

    return `${safeCount} solicitações de amizade pendentes`;
  }

  private buildShellContextActions(
    currentUrl: string,
    navVm: AuthenticatedNavigationVm,
    friendRequestsCount: number
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

    if (
      friendRequestsCount > 0 &&
      !needsProfileCompletion &&
      !needsEmailVerification &&
      clean !== '/friends/requests'
    ) {
      const formattedCount = this.formatBadgeCount(friendRequestsCount);

      actions.push({
        id: 'friend-requests',
        label: `Solicitações (${formattedCount})`,
        route: ['/friends/requests'],
        icon: '🤝',
        ariaLabel: `Abrir solicitações de amizade. ${this.buildFriendRequestsBadgeLabel(friendRequestsCount)}.`,
        variant: 'primary',
        badgeCount: friendRequestsCount,
        badgeLabel: `${friendRequestsCount} solicitação de amizade pendente`,
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
        variant: 'primary',
      });
    }

    if (
      needsProfileCompletion &&
      !needsEmailVerification &&
      clean !== '/register/finalizar-cadastro'
    ) {
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
}
