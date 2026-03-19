// src/app/header/navbar/navbar.component.ts
// Buscar padronizar no que for possível em "uid"
// Não esqueça os comentários explicativos.
// TODO(STATE): Criar canShowLinksInteraction$ (fonte: AuthSession.ready$ + AuthSession.uid$ + URL atual).
// - Objetivo: não renderizar <app-links-interaction> quando uid=null ou em rotas públicas.
// - Padrão “plataforma grande”: o componente nem deve existir nessas rotas.
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
  // ===========================================================================
  // Estado exposto ao template
  // ===========================================================================

  public isAuthenticated = false;
  public nickname = '';
  public photoURL = '';

  /**
   * userId (LEGADO): na prática é o UID do Firebase.
   * - Mantido para evitar quebra em bindings/uso externo.
   * - Fonte única de verdade: AuthSessionService.uid$.
   * - Recomendação de evolução: renomear para uid no template e remover userId.
   */
  public userId = '';

  // Mostra banner/upsell ao visitante e plano free
  public isFree = false;

  /**
   * UI route flags
   * - isLoginPage: mantém compat com o template atual.
   * - isPublicAuthRoute: cobre /login, /register e handlers de auth.
   * - canShowLinksInteraction / canShowGuestBanner: evitam instanciar componentes
   *   em rotas públicas ou sem usuário autenticado.
   */
  public isLoginPage = false;
  public isPublicAuthRoute = false;
  public canShowLinksInteraction = false;
  public canShowGuestBanner = false;

  // ===========================================================================
  // Tema / acessibilidade
  // ===========================================================================

  private _isDarkModeActive = false;
  private _isHighContrastActive = false;

  isDarkMode(): boolean { return this._isDarkModeActive; }
  isHighContrast(): boolean { return this._isHighContrastActive; }

  private prefersDarkMql?: MediaQueryList;
  private prefersDarkListener?: (ev: MediaQueryListEvent) => void;

  // ===========================================================================
  // Injeções
  // ===========================================================================

  /**
   * Auth do AngularFire:
   * - mantido apenas para debug/comparação via authState$()
   * - não é a fonte canônica de uid neste componente
   */
  private readonly auth = inject(Auth);

  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly sidebarService = inject(SidebarService);
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly notify = inject(ErrorNotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logoutService = inject(LogoutService);

  // ===========================================================================
  // Debug / observabilidade
  // ===========================================================================

  /**
   * Debug do Navbar:
   * localStorage.setItem('debug.navbar', '1')
   */
  private readonly debugNavbar = localStorage.getItem('debug.navbar') === '1';
  private _logSeq = 0;

  private logNavbar(tag: string, payload?: unknown): void {
    if (!this.debugNavbar) return;

    const seq = ++this._logSeq;
    const ts = new Date().toISOString();

    // eslint-disable-next-line no-console
    console.debug(`[NAVBAR][${seq}][${ts}] ${tag}`, payload ?? '');
  }

  private getRouteParamIdSnapshot(): string | null {
    let node = this.router.routerState.snapshot.root;
    while (node.firstChild) node = node.firstChild;
    return (node.params?.['id'] as string) ?? null;
  }

  // ===========================================================================
  // Streams base
  // ===========================================================================

  /**
   * Stream direto do AngularFire Auth:
   * - mantido só para debug/comparação
   * - não deve governar uid da UI
   */
  private authState$(): Observable<User | null> {
    return runInInjectionContext(this.injector, () => afUser(this.auth)).pipe(
      startWith(this.auth.currentUser),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Stream do perfil do usuário no domínio do app.
   * Pode emitir:
   * - undefined: ainda não hidratou
   * - null: deslogado
   * - IUserDados: logado e hidratado
   */
  private appUser$(): Observable<IUserDados | null | undefined> {
    return this.currentUserStore.user$.pipe(
      startWith(undefined),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  // ===========================================================================
  // Helpers de rota / visibilidade
  // ===========================================================================

  private isLoginRoute(url: string | null | undefined): boolean {
    const path = (url ?? '').split('?')[0].split('#')[0];
    return /^\/login(\/|$)/.test(path);
  }

  /**
   * Regras atuais do header:
   * - LinksInteraction só quando autenticado e fora das rotas públicas de auth.
   * - GuestBanner idem.
   *
   * Obs.:
   * O GuestBanner ainda faz sua própria validação interna.
   * Aqui só evitamos instanciar o componente quando já sabemos que não faz sentido.
   */
private recomputeHeaderVisibility(): void {
  const hasAuthenticatedUser = this.isAuthenticated && !!this.userId;
  const canShow = hasAuthenticatedUser && !this.isPublicAuthRoute;

  this.canShowLinksInteraction = canShow;
  this.canShowGuestBanner = canShow;
}

private syncRouteUiFlags(url: string | null | undefined): void {
  const normalizedUrl = url ?? '';
  this.isLoginPage = this.isLoginRoute(normalizedUrl);
  this.isPublicAuthRoute = this.isLoginPage || isRegistrationFlow(normalizedUrl);
  this.recomputeHeaderVisibility();
}

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  ngOnInit(): void {
    // sincroniza estado inicial da rota antes de qualquer render
    this.syncRouteUiFlags(this.router.url);

    // -------------------------------------------------------------------------
    // Fonte única de uid
    // -------------------------------------------------------------------------
    const uid$ = this.session.uid$.pipe(
      startWith(this.session.currentAuthUser?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // -------------------------------------------------------------------------
    // Bootstrap gate do auth
    // -------------------------------------------------------------------------
    const ready$ = this.session.ready$.pipe(
      startWith(false),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // -------------------------------------------------------------------------
    // Estado autenticado, respeitando o ready gate
    // -------------------------------------------------------------------------
    const isAuthenticated$ = combineLatest([ready$, this.session.isAuthenticated$]).pipe(
      map(([ready, isAuth]) => ready ? isAuth : false),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // -------------------------------------------------------------------------
    // Perfil do app e authUser de fallback visual
    // -------------------------------------------------------------------------
    const appUser$ = this.appUser$();

    const authUser$ = this.session.authUser$.pipe(
      startWith(this.session.currentAuthUser ?? null),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // -------------------------------------------------------------------------
    // ViewModel do navbar
    // -------------------------------------------------------------------------
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

          // debug
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

    // -------------------------------------------------------------------------
    // Assinatura única de estado imperativo
    // -------------------------------------------------------------------------
vm$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(vm => {
  const prevUid = this.userId;

  this.isAuthenticated = vm.isAuthenticated;
  this.nickname = vm.nickname;
  this.photoURL = vm.photoURL;
  this.userId = vm.uid;
  this.isFree = vm.isFree;

  this.recomputeHeaderVisibility();

  this.logNavbar('STATE applied', {
    prevUid,
    nextUid: this.userId,
    isAuthenticated: this.isAuthenticated,
    isPublicAuthRoute: this.isPublicAuthRoute,
    canShowLinksInteraction: this.canShowLinksInteraction,
    canShowGuestBanner: this.canShowGuestBanner,
    url: this.router.url
  });
});

    // -------------------------------------------------------------------------
    // Debug watchers
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // Watcher de rota para flags de UI
    // -------------------------------------------------------------------------
    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd),
        startWith(null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.syncRouteUiFlags(this.router.url);
      });

    // -------------------------------------------------------------------------
    // Tema / contraste
    // -------------------------------------------------------------------------
    this.initializeThemes();
    this.bindSystemPrefersDark();
  }

  ngOnDestroy(): void {
    if (this.prefersDarkMql && this.prefersDarkListener) {
      this.prefersDarkMql.removeEventListener('change', this.prefersDarkListener);
    }
  }

  // ===========================================================================
  // Ações / debug
  // ===========================================================================

  onMyProfileClick(): void {
    this.logNavbar('CLICK Meu Perfil', {
      navbar_uid: this.userId,
      session_uid_snapshot: this.session.currentAuthUser?.uid ?? null,
      route_id_snapshot: this.getRouteParamIdSnapshot(),
      url: this.router.url
    });
  }

  // ===========================================================================
  // Theme state machine
  // ===========================================================================

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
      // ambiente sem matchMedia
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

  // ===========================================================================
  // Navegação / ações
  // ===========================================================================

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

  onToggleSidebar(): void {
    this.sidebarService.toggleSidebar();
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
        // eslint-disable-next-line no-console
        console.error('[NavbarComponent] Erro no logout:', error);
        this.notify.showError('Não foi possível sair agora. Tente novamente.');
      }
    });
  }
}
