// src/app/header/navbar/navbar.component.ts
// ============================================================================
// NAVBAR
// ----------------------------------------------------------------------------
// Objetivo desta revisão:
// - manter o navbar como barra única
// - limpar resíduos de integração com LinksInteractionComponent
// - preservar uid como fonte canônica do header
// - manter toggle da sidebar, responsividade e debug útil
//
// Supressões explícitas desta versão:
// 1) canShowLinksInteraction
// 2) TODO sobre canShowLinksInteraction$
// 3) logs ligados a esse estado
import {
  Component,
  DestroyRef,
  Injector,
  OnDestroy,
  OnInit,
  inject,
  runInInjectionContext
} from '@angular/core';

import {
  Router,
  NavigationEnd,
  NavigationStart,
  NavigationCancel,
  NavigationError
} from '@angular/router';

import {
  filter,
  startWith,
  map,
  distinctUntilChanged,
  shareReplay,
  take,
  tap
} from 'rxjs/operators';

import { combineLatest, Observable } from 'rxjs';

import { BreakpointObserver } from '@angular/cdk/layout';

import { SidebarService } from 'src/app/core/services/navigation/sidebar.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { Auth, user as afUser } from '@angular/fire/auth';
import type { User } from 'firebase/auth';
import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { inRegistrationFlow as isRegistrationFlow } from 'src/app/core/services/autentication/auth/auth.types';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
  standalone: false
})
export class NavbarComponent implements OnInit, OnDestroy {
  public isAuthenticated = false;
  public nickname = '';
  public photoURL = '';
  public userId = '';
  public isFree = false;

  public isLoginPage = false;
  public isPublicAuthRoute = false;
  public canShowGuestBanner = false;

  /**
   * Mantidos por compatibilidade, mas o hambúrguer do navbar
   * deixa de controlar a sidebar nesta fase.
   */
  public isOverlayViewport = false;
  public shouldShowSidebarToggle = false;
  public isSidebarOpen = false;

  /**
   * Novo estado do menu mobile do próprio navbar.
   */
  public isMobileMenuViewport = false;
  public isMobileMenuOpen = false;

  private _isDarkModeActive = false;
  private _isHighContrastActive = false;

  isDarkMode(): boolean { return this._isDarkModeActive; }
  isHighContrast(): boolean { return this._isHighContrastActive; }

  private prefersDarkMql?: MediaQueryList;
  private prefersDarkListener?: (ev: MediaQueryListEvent) => void;

  private readonly auth = inject(Auth);

  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly sidebarService = inject(SidebarService);
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly notify = inject(ErrorNotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logoutService = inject(LogoutService);
  private readonly breakpointObserver = inject(BreakpointObserver);

  /**
   * Mantido para o shell/sidebar, sem uso direto no hambúrguer do navbar.
   */
  private readonly sidebarOverlayBreakpoint = '(max-width: 1279.98px)';

  /**
   * Breakpoint do colapso do menu do navbar.
   * Aqui os links horizontais somem e entram no painel dropdown.
   */
  private readonly mobileMenuBreakpoint = '(max-width: 860px)';

  private readonly debugNavbar = localStorage.getItem('debug.navbar') === '1';
  private _logSeq = 0;

  private logNavbar(tag: string, payload?: unknown): void {
    if (!this.debugNavbar) return;

    const seq = ++this._logSeq;
    const ts = new Date().toISOString();

    console.debug(`[NAVBAR][${seq}][${ts}] ${tag}`, payload ?? '');
  }

  private getRouteParamIdSnapshot(): string | null {
    let node = this.router.routerState.snapshot.root;
    while (node.firstChild) node = node.firstChild;
    return (node.params?.['id'] as string) ?? null;
  }

  private authState$(): Observable<User | null> {
    return runInInjectionContext(this.injector, () => afUser(this.auth)).pipe(
      startWith(this.auth.currentUser),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private appUser$(): Observable<IUserDados | null | undefined> {
    return this.currentUserStore.user$.pipe(
      startWith(undefined),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private isLoginRoute(url: string | null | undefined): boolean {
    const path = (url ?? '').split('?')[0].split('#')[0];
    return /^\/login(\/|$)/.test(path);
  }

  private recomputeHeaderVisibility(): void {
    const hasAuthenticatedUser = this.isAuthenticated && !!this.userId;
    const canShow = hasAuthenticatedUser && !this.isPublicAuthRoute;

    this.canShowGuestBanner = canShow;
  }

  /**
   * Agora o hambúrguer do navbar NÃO controla mais a sidebar.
   * Mantemos o estado por compatibilidade, mas sem exibição no navbar.
   */
  private recomputeSidebarToggleVisibility(): void {
    this.shouldShowSidebarToggle = false;
  }

  private syncRouteUiFlags(url: string | null | undefined): void {
    const normalizedUrl = url ?? '';
    this.isLoginPage = this.isLoginRoute(normalizedUrl);
    this.isPublicAuthRoute = this.isLoginPage || isRegistrationFlow(normalizedUrl);

    this.recomputeHeaderVisibility();
    this.recomputeSidebarToggleVisibility();
  }

  ngOnInit(): void {
    this.syncRouteUiFlags(this.router.url);

    this.breakpointObserver
      .observe(this.sidebarOverlayBreakpoint)
      .pipe(
        map(state => state.matches),
        distinctUntilChanged(),
        tap(matches => {
          this.isOverlayViewport = matches;
          this.recomputeSidebarToggleVisibility();

          this.logNavbar('overlay breakpoint changed', {
            matches,
            url: this.router.url,
            shouldShowSidebarToggle: this.shouldShowSidebarToggle
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.breakpointObserver
      .observe(this.mobileMenuBreakpoint)
      .pipe(
        map(state => state.matches),
        distinctUntilChanged(),
        tap(matches => {
          this.isMobileMenuViewport = matches;

          if (!matches && this.isMobileMenuOpen) {
            this.isMobileMenuOpen = false;
          }

          this.logNavbar('mobileMenu breakpoint changed', {
            matches,
            isMobileMenuOpen: this.isMobileMenuOpen,
            url: this.router.url
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.sidebarService.vm$
      .pipe(
        map(vm => !!vm.isOpen),
        distinctUntilChanged(),
        tap(isOpen => {
          this.isSidebarOpen = isOpen;

          this.logNavbar('sidebar vm changed', {
            isOpen,
            url: this.router.url
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    const uid$ = this.session.uid$.pipe(
      startWith(this.session.currentAuthUser?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const ready$ = this.session.ready$.pipe(
      startWith(false),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const isAuthenticated$ = combineLatest([ready$, this.session.isAuthenticated$]).pipe(
      map(([ready, isAuth]) => ready ? isAuth : false),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const appUser$ = this.appUser$();

    const authUser$ = this.session.authUser$.pipe(
      startWith(this.session.currentAuthUser ?? null),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const vm$ = combineLatest([ready$, uid$, isAuthenticated$, appUser$, authUser$]).pipe(
      map(([ready, uid, isAuth, appUser, authUser]) => {
        const safeUid = uid ?? '';

        const fallbackNickname =
          authUser?.displayName ??
          (authUser?.email ? authUser.email.split('@')[0] : '');

        const fallbackPhoto = (authUser as any)?.photoURL ?? '';

        const nickname = appUser?.nickname ?? fallbackNickname ?? '';
        const photoURL = (appUser as any)?.photoURL ?? fallbackPhoto ?? '';

        const role = (appUser as any)?.role ?? (isAuth ? 'basic' : 'visitante');
        const isFree = !isAuth || role === 'free';

        return {
          ready,
          isAuthenticated: isAuth,
          uid: safeUid,
          nickname,
          photoURL,
          isFree,
          __auth_uid_snapshot: this.session.currentAuthUser?.uid ?? null,
          __store_uid: (appUser as any)?.uid ?? null,
          __route_id_snapshot: this.getRouteParamIdSnapshot(),
          __url: this.router.url
        };
      }),
      distinctUntilChanged((a, b) =>
        a.ready === b.ready &&
        a.isAuthenticated === b.isAuthenticated &&
        a.uid === b.uid &&
        a.nickname === b.nickname &&
        a.photoURL === b.photoURL &&
        a.isFree === b.isFree
      ),
      tap(vm => {
        this.logNavbar('vm$ emit', {
          ready: vm.ready,
          isAuthenticated: vm.isAuthenticated,
          uid: vm.uid,
          store_uid: (vm as any).__store_uid,
          auth_uid_snapshot: (vm as any).__auth_uid_snapshot,
          route_id_snapshot: (vm as any).__route_id_snapshot,
          url: (vm as any).__url,
          userId_before_apply: this.userId
        });
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    vm$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(vm => {
      const prevUid = this.userId;

      this.isAuthenticated = vm.isAuthenticated;
      this.nickname = vm.nickname;
      this.photoURL = vm.photoURL;
      this.userId = vm.uid;
      this.isFree = vm.isFree;

      this.recomputeHeaderVisibility();
      this.recomputeSidebarToggleVisibility();

      this.logNavbar('STATE applied', {
        prevUid,
        nextUid: this.userId,
        isAuthenticated: this.isAuthenticated,
        isPublicAuthRoute: this.isPublicAuthRoute,
        canShowGuestBanner: this.canShowGuestBanner,
        isMobileMenuViewport: this.isMobileMenuViewport,
        isMobileMenuOpen: this.isMobileMenuOpen,
        url: this.router.url
      });
    });

    if (this.debugNavbar) {
      uid$
        .pipe(
          tap(uid => this.logNavbar('session.uid$ (SOURCE OF TRUTH)', { uid, url: this.router.url })),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe();

      this.session.ready$
        .pipe(
          distinctUntilChanged(),
          tap(ready => this.logNavbar('session.ready$', { ready, url: this.router.url })),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe();

      this.currentUserStore.user$
        .pipe(
          map(u => (u as any)?.uid ?? null),
          distinctUntilChanged(),
          tap(uid => this.logNavbar('store.user$.uid (DOMAIN)', { uid, url: this.router.url })),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe();

      this.authState$()
        .pipe(
          map(u => u?.uid ?? null),
          distinctUntilChanged(),
          tap(uid => this.logNavbar('firebase.authState$ (DEBUG)', { uid, url: this.router.url })),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe();

      this.router.events
        .pipe(
          filter(e =>
            e instanceof NavigationStart ||
            e instanceof NavigationEnd ||
            e instanceof NavigationCancel ||
            e instanceof NavigationError
          ),
          tap((e: any) => {
            this.logNavbar('router.event', {
              type: e.constructor?.name,
              url: e.url,
              reason: (e as any).reason,
              code: (e as any).code,
              navbar_uid_now: this.userId,
              session_uid_snapshot: this.session.currentAuthUser?.uid ?? null
            });
          }),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe();
    }

    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd),
        startWith(null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.syncRouteUiFlags(this.router.url);

        if (this.isMobileMenuOpen) {
          this.isMobileMenuOpen = false;
        }
      });

    this.initializeThemes();
    this.bindSystemPrefersDark();
  }

  ngOnDestroy(): void {
    if (this.prefersDarkMql && this.prefersDarkListener) {
      this.prefersDarkMql.removeEventListener('change', this.prefersDarkListener);
    }
  }

  onMyProfileClick(): void {
    this.logNavbar('CLICK Meu Perfil', {
      navbar_uid: this.userId,
      session_uid_snapshot: this.session.currentAuthUser?.uid ?? null,
      route_id_snapshot: this.getRouteParamIdSnapshot(),
      url: this.router.url
    });
  }

  private initializeThemes(): void {
    const root = document.documentElement;

    const persistedTheme = localStorage.getItem('theme');
    const persistedHc = localStorage.getItem('high-contrast');

    if (persistedTheme === 'dark') this._isDarkModeActive = true;
    if (persistedTheme === 'light') this._isDarkModeActive = false;
    if (persistedHc === '1') this._isHighContrastActive = true;

    if (persistedTheme == null) {
      this._isDarkModeActive = root.classList.contains('dark-mode');
    }

    if (persistedHc == null) {
      this._isHighContrastActive = root.classList.contains('high-contrast');
    }

    this.applyThemeStates(false);
  }

  private bindSystemPrefersDark(): void {
    const userChose = localStorage.getItem('theme') !== null;
    if (userChose) return;

    try {
      this.prefersDarkMql = window.matchMedia?.('(prefers-color-scheme: dark)');

      if (this.prefersDarkMql) {
        this._isDarkModeActive = !!this.prefersDarkMql.matches;
        this.applyThemeStates(false);

        this.prefersDarkListener = (ev) => {
          this._isDarkModeActive = ev.matches;
          this.applyThemeStates(false);
        };

        this.prefersDarkMql.addEventListener('change', this.prefersDarkListener);
      }
    } catch {
      // noop
    }
  }

  private applyThemeStates(persist: boolean = true): void {
    const root = document.documentElement;

    root.classList.toggle('dark-mode', this._isDarkModeActive);
    root.classList.toggle('high-contrast', this._isHighContrastActive);

    root.style.colorScheme = this._isDarkModeActive ? 'dark' : 'light';
    root.setAttribute('data-theme', this._isDarkModeActive ? 'dark' : 'light');
    root.setAttribute('data-hc', this._isHighContrastActive ? 'on' : 'off');

    if (persist) {
      localStorage.setItem('theme', this._isDarkModeActive ? 'dark' : 'light');
      localStorage.setItem('high-contrast', this._isHighContrastActive ? '1' : '0');
    }
  }

  toggleDarkMode(): void {
    this._isDarkModeActive = !this._isDarkModeActive;
    this.applyThemeStates(true);
  }

  toggleHighContrast(): void {
    this._isHighContrastActive = !this._isHighContrastActive;
    this.applyThemeStates(true);
  }

  resetAppearance(): void {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('high-contrast', '0');

    this._isDarkModeActive = false;
    this._isHighContrastActive = false;
    this.applyThemeStates(false);
  }

  goToMyProfile(ev?: Event): void {
    ev?.preventDefault();

    const uid = this.userId || this.session.currentAuthUser?.uid || '';

    if (!uid) {
      this.notify.showError('Não foi possível identificar sua sessão agora. Tente novamente.');
      return;
    }

    this.router.navigate(['/perfil', uid]).catch((err) => {
      this.logNavbar('goToMyProfile navigation error', { err });
      this.notify.showError('Não foi possível abrir seu perfil agora.');
    });
  }

  /**
   * Mantido apenas por compatibilidade.
   * O hambúrguer do navbar não usa mais esse método.
   */
  onToggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
  }

  get myProfileLink(): any[] {
    const uid = this.userId || this.session.currentAuthUser?.uid || '';
    return uid ? ['/perfil', uid] : ['/perfil'];
  }

  onMyProfileLinkClick(ev: MouseEvent): void {
    this.onMyProfileClick();

    this.logNavbar('CLICK Meu Perfil (link)', {
      button: ev.button,
      ctrl: ev.ctrlKey,
      meta: ev.metaKey,
      shift: ev.shiftKey,
      alt: ev.altKey,
      defaultPrevented: ev.defaultPrevented,
      targetUrl: this.myProfileLink,
      currentUrl: this.router.url,
    });
  }

  logout(): void {
    this.logoutService.logout$().pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.notify.showSuccess('Você saiu da sua conta.');
      },
      error: (error) => {
        this.logNavbar('logout error', { error });
        console.error('[NavbarComponent] Erro no logout:', error);
        this.notify.showError('Não foi possível sair agora. Tente novamente.');
      }
    });
  }
}