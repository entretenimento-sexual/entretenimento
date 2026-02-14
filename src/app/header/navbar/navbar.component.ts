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

import { combineLatest, Observable, of } from 'rxjs';

import { SidebarService } from 'src/app/core/services/sidebar.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { Auth, user as afUser } from '@angular/fire/auth';
import type { User } from 'firebase/auth';
import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
  standalone: false
})
export class NavbarComponent implements OnInit, OnDestroy {
  // ===========================================================================
  // Estado exposto ao template
  // - Mantido como no seu código (imperativo), mas o abastecimento vem de vm$.
  // - Em “plataformas grandes”, preferem expor vm$ e usar async pipe para reduzir
  //   mutabilidade. Aqui preservo seu padrão atual.
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

  public isLoginPage = false;

  // Mostra banner/upsell ao visitante e plano free
  public isFree = false;

  // ===========================================================================
  // === Tema/Acessibilidade ===
  // - Funciona no Navbar, mas em “plataformas grandes” normalmente vai para um
  //   ThemeService global (app shell) porque é estado transversal do app.
  // ===========================================================================

  private _isDarkModeActive = false;
  private _isHighContrastActive = false;

  /**
   * isDarkMode()
   * - O que faz: getter para o template renderizar o ícone/estado.
   * - Deve permanecer no navbar? Pode, mas idealmente o estado deveria vir
   *   de um ThemeService (single source of truth de UI global).
   */
  isDarkMode(): boolean { return this._isDarkModeActive; }

  /**
   * isHighContrast()
   * - O que faz: getter para o template renderizar texto/estado.
   * - Mesmo comentário do isDarkMode().
   */
  isHighContrast(): boolean { return this._isHighContrastActive; }

  private prefersDarkMql?: MediaQueryList;
  private prefersDarkListener?: (ev: MediaQueryListEvent) => void;

  // ===========================================================================
  // Injeções
  // ===========================================================================

  /**
   * auth (AngularFire Auth)
   * - Neste Navbar, não deve ser usado como fonte de UID.
   * - Mantido porque você pediu para não remover métodos (authState$),
   *   mas o UID canônico vem do AuthSessionService.uid$.
   * - Em “plataformas grandes”, o Navbar NÃO depende direto de Auth.
   */
  private readonly auth = inject(Auth);

  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly sidebarService = inject(SidebarService);

  /**
   * AuthSessionService (FONTE ÚNICA DO UID)
   * - Dono do UID e do “ready gate” para evitar estados transitórios.
   */
  private readonly session = inject(AuthSessionService);

  /**
   * CurrentUserStoreService (FONTE DO PERFIL)
   * - Dono do IUserDados (nickname, photoURL, role, etc).
   * - Pode emitir undefined (não hidratou), null (deslogado), ou objeto (logado).
   */
  private readonly currentUserStore = inject(CurrentUserStoreService);

  /**
   * ErrorNotificationService
   * - Notificação ao usuário (toast/snack).
   * - Em “plataformas grandes”: notifica aqui; logging/telemetria vai para
   *   handler central (GlobalErrorHandler) ou observability layer.
   */
  private readonly notify = inject(ErrorNotificationService);

  private readonly destroyRef = inject(DestroyRef);
  private readonly logoutService = inject(LogoutService);

  // ===========================================================================
  // Debug/Observabilidade
  // ===========================================================================

  /**
   * Debug do Navbar (liga/desliga sem mexer em código):
   * - Para ligar:  localStorage.setItem('debug.navbar', '1') e recarregue
   * - Para desligar: localStorage.removeItem('debug.navbar')
   */
  private readonly debugNavbar = localStorage.getItem('debug.navbar') === '1';

  /**
   * Sequência para ordenar logs (causalidade / “quem veio primeiro”).
   * Em depuração de auth, a ordem é quase sempre o ponto crítico.
   */
  private _logSeq = 0;

  /**
   * logNavbar()
   * - O que faz: log padronizado e facilmente filtrável no console.
   * - Deve permanecer no navbar? Sim, como ferramenta local de debug.
   * - Evolução ideal: usar logger central (com níveis) + correlação de sessão.
   */
  private logNavbar(tag: string, payload?: unknown): void {
    if (!this.debugNavbar) return;
    const seq = ++this._logSeq;
    const ts = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.debug(`[NAVBAR][${seq}][${ts}] ${tag}`, payload ?? '');
  }

  /**
   * getRouteParamIdSnapshot()
   * - O que faz: lê :id do nó mais profundo do snapshot atual.
   * - Deve permanecer no navbar? NÃO como regra.
   *   Isso é diagnóstico/telemetria; em apps grandes vira RouterDiagnosticsService.
   * - Mantido por compatibilidade e porque você usa nos logs.
   */
  private getRouteParamIdSnapshot(): string | null {
    let node = this.router.routerState.snapshot.root;
    while (node.firstChild) node = node.firstChild;
    return (node.params?.['id'] as string) ?? null;
  }

   // ===========================================================================
  // ===== Streams base (LEGADO/DEBUG vs CANÔNICO) =====
  // ===========================================================================

  /**
   * authState$()
   * - O que faz: stream de User do AngularFire Auth (direto).
   * - Deve permanecer no navbar? Idealmente NÃO.
   * - Importante: NÃO é fonte de UID aqui. UID canônico vem do AuthSessionService.
   * - Mantido para debug/comparação (detectar divergências).
   */
  private authState$(): Observable<User | null> {
    return runInInjectionContext(this.injector, () => afUser(this.auth)).pipe(
      startWith(this.auth.currentUser),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * appUser$()
   * - O que faz: stream do perfil (IUserDados) vindo do store.
   * - Deve permanecer no navbar? Sim, porque o navbar precisa de nickname/foto/role.
   * - Nota: esse stream NÃO deve decidir UID.
   */
  private appUser$(): Observable<IUserDados | null | undefined> {
    return this.currentUserStore.user$.pipe(
      startWith(undefined),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * ngOnInit()
   * - O que faz: cria vm$ reativo e assina uma única vez para abastecer o template.
   * - Ajuste principal: UID vem exclusivamente de AuthSessionService.uid$ (fonte única).
   * - Em plataformas grandes:
   *   - vm$ seria exposto e consumido no template com async pipe.
   *   - watchers de debug seriam ativados só no modo debug (como abaixo).
   */
  ngOnInit(): void {
    // ----- Fonte ÚNICA para UID (canônica)
    // startWith usando session.currentAuthUser é aceitável porque continua “dentro”
    // da sessão. Não use this.auth.currentUser como fonte aqui.
    const uid$ = this.session.uid$.pipe(
      startWith(this.session.currentAuthUser?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // ----- Gating de bootstrap: evita flicker/transientes antes do Auth restaurar.
    const ready$ = this.session.ready$.pipe(
      startWith(false),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // ----- Auth state (boolean) vindo do próprio AuthSessionService
    // Em apps grandes, normalmente “isAuthenticated” só é considerado após ready.
    const isAuthenticated$ = combineLatest([ready$, this.session.isAuthenticated$]).pipe(
      map(([ready, isAuth]) => (ready ? isAuth : false)),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // ----- Perfil (domínio) vindo do CurrentUserStoreService
    const appUser$ = this.appUser$();

    // ----- Dados básicos do authUser (ainda dentro do AuthSessionService)
    // Usado somente como fallback visual (nickname/foto) enquanto o perfil não hidrata.
    const authUser$ = this.session.authUser$.pipe(
      startWith(this.session.currentAuthUser ?? null),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // =========================================================================
    // ViewModel do Navbar
    // - UID: SEMPRE do uid$
    // - nickname/photo/role: prefere appUser; fallback no authUser
    // - isFree: derivado de role/isAuthenticated
    // =========================================================================
    const vm$ = combineLatest([ready$, uid$, isAuthenticated$, appUser$, authUser$]).pipe(
      map(([ready, uid, isAuth, appUser, authUser]) => {
        const safeUid = uid ?? '';

        // Fallbacks visuais (não determinam UID)
        const fallbackNickname =
          authUser?.displayName ??
          (authUser?.email ? authUser.email.split('@')[0] : '');

        const fallbackPhoto = (authUser as any)?.photoURL ?? '';

        const nickname = appUser?.nickname ?? fallbackNickname ?? '';
        const photoURL = (appUser as any)?.photoURL ?? fallbackPhoto ?? '';

        // Regra de plano (exatamente como antes, mas com fontes mais consistentes)
        const role = (appUser as any)?.role ?? (isAuth ? 'basic' : 'visitante');
        const isFree = !isAuth || role === 'free';

        return {
          ready,
          isAuthenticated: isAuth,
          uid: safeUid,
          nickname,
          photoURL,
          isFree,

          // Debug fields
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

    // Assinatura única (estado imperativo do componente)
    vm$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(vm => {
      const prevUid = this.userId;

      this.isAuthenticated = vm.isAuthenticated;
      this.nickname = vm.nickname;
      this.photoURL = vm.photoURL;

      // ✅ userId recebe UID (fonte única: session.uid$)
      this.userId = vm.uid;

      this.isFree = vm.isFree;

      this.logNavbar('STATE applied', {
        prevUid,
        nextUid: this.userId,
        isAuthenticated: this.isAuthenticated,
        url: this.router.url
      });
    });

    // =========================================================================
    // Debug watchers (somente quando debugNavbar está ligado)
    // - Isso evita custo/ruído em produção.
    // - Aqui você consegue comparar “fonte única (session.uid$)” vs store vs auth.
    // =========================================================================
    if (this.debugNavbar) {
      uid$.pipe(
        tap(uid => this.logNavbar('session.uid$ (SOURCE OF TRUTH)', { uid, url: this.router.url })),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe();

      this.session.ready$.pipe(
        distinctUntilChanged(),
        tap(ready => this.logNavbar('session.ready$', { ready, url: this.router.url })),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe();

      this.currentUserStore.user$.pipe(
        map(u => (u as any)?.uid ?? null),
        distinctUntilChanged(),
        tap(uid => this.logNavbar('store.user$.uid (DOMAIN)', { uid, url: this.router.url })),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe();

      // Mantido: comparação com AngularFire authState$ (debug)
      this.authState$().pipe(
        map(u => u?.uid ?? null),
        distinctUntilChanged(),
        tap(uid => this.logNavbar('firebase.authState$ (DEBUG)', { uid, url: this.router.url })),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe();

      // Router events para correlacionar timing
      this.router.events.pipe(
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
      ).subscribe();
    }

    // =========================================================================
    // Route watcher (isLoginPage)
    // - O que faz: marca se a rota atual é /login para controlar UI.
    // - Deve permanecer no navbar? Sim, é decisão puramente de UI do header.
    // - Evolução: derivar de um stream (isLoginPage$) e usar async.
    // =========================================================================
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      startWith({} as NavigationEnd),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.isLoginPage = this.router.url === '/login';
    });

    // =========================================================================
    // Tema/Contraste
    // - Mantido aqui por ora, mas esse bloco tende a crescer; considere ThemeService.
    // =========================================================================
    this.initializeThemes();
    this.bindSystemPrefersDark();
  }

  /**
   * ngOnDestroy()
   * - O que faz: remove listener do matchMedia para evitar leak.
   * - Deve permanecer no navbar? Sim (se o listener é registrado aqui).
   * - Evolução: mover para ThemeService, então o navbar não cuidaria disso.
   */
  ngOnDestroy(): void {
    if (this.prefersDarkMql && this.prefersDarkListener) {
      this.prefersDarkMql.removeEventListener('change', this.prefersDarkListener);
    }
  }

  /**
   * onMyProfileClick()
   * - O que faz: loga o estado no clique (diagnóstico).
   * - Deve permanecer no navbar? Pode, mas só como debug.
   * - Observação: UID exibido aqui é o do Navbar (derivado do session.uid$).
   */
  onMyProfileClick(): void {
    this.logNavbar('CLICK Meu Perfil', {
      navbar_uid: this.userId,
      session_uid_snapshot: this.session.currentAuthUser?.uid ?? null,
      route_id_snapshot: this.getRouteParamIdSnapshot(),
      url: this.router.url
    });
  }

  // =========================
  //    THEME STATE MACHINE
  // =========================

  /**
   * initializeThemes()
   * - O que faz: restaura preferências persistidas + sincroniza DOM.
   * - Deve permanecer no navbar? Funciona, mas em escala é ThemeService.
   */
  private initializeThemes(): void {
    const root = document.documentElement;

    const persistedTheme = localStorage.getItem('theme');          // 'dark' | 'light' | null
    const persistedHc = localStorage.getItem('high-contrast');     // '1' | '0' | null

    if (persistedTheme === 'dark') this._isDarkModeActive = true;
    if (persistedTheme === 'light') this._isDarkModeActive = false;
    if (persistedHc === '1') this._isHighContrastActive = true;

    // fallback inicial pelo DOM, se nada persistido
    if (persistedTheme == null) {
      this._isDarkModeActive = root.classList.contains('dark-mode');
    }
    if (persistedHc == null) {
      this._isHighContrastActive = root.classList.contains('high-contrast');
    }

    this.applyThemeStates(false);
  }

  /**
   * bindSystemPrefersDark()
   * - O que faz: segue o tema do SO apenas se o usuário não “fixou” tema.
   * - Deve permanecer no navbar? Funciona, mas ideal é ThemeService.
   */
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
      // ambiente sem matchMedia – ignora silenciosamente
    }
  }

  /**
   * applyThemeStates()
   * - O que faz: aplica classes/atributos no <html> e persiste preferências.
   * - Deve permanecer no navbar? Pode, mas é global; em escala, ThemeService.
   */
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

  /**
   * toggleDarkMode()
   * - O que faz: alterna tema e aplica/persiste.
   * - Deve permanecer no navbar? Sim enquanto o tema for controlado aqui.
   */
  toggleDarkMode(): void {
    this._isDarkModeActive = !this._isDarkModeActive;
    this.applyThemeStates(true);
  }

  /**
   * toggleHighContrast()
   * - O que faz: alterna alto contraste e aplica/persiste.
   * - Deve permanecer no navbar? Sim enquanto o controle estiver aqui.
   */
  toggleHighContrast(): void {
    this._isHighContrastActive = !this._isHighContrastActive;
    this.applyThemeStates(true);
  }

  /**
   * resetAppearance()
   * - O que faz: reseta para claro + HC off, atualiza DOM sem repersistir “duplicado”.
   * - Deve permanecer no navbar? Pode, mas em escala vira ação do ThemeService.
   */
  resetAppearance(): void {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('high-contrast', '0');

    this._isDarkModeActive = false;
    this._isHighContrastActive = false;
    this.applyThemeStates(false);
  }

  /**
   * goToMyProfile()
   * - O que faz: navega para o perfil do usuário logado.
   * - Ajuste principal: usa a fonte única de UID (this.userId abastecido por session.uid$).
   * - Deve permanecer no navbar? Sim, é ação típica do header.
   * - Evolução: o template deveria chamar este método (evitar /meu-perfil “mágico”),
   *   para sempre cair em /perfil/:uid de forma canônica.
   */
  goToMyProfile(ev?: Event): void {
    ev?.preventDefault();

    // Fonte única: userId é o UID que veio do AuthSessionService.uid$
    // Fallback somente para tolerância (não como regra): snapshot do session.currentAuthUser.
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
   * onToggleSidebar()
   * - O que faz: delega para SidebarService.
   * - Deve permanecer no navbar? Sim (ação de UI do header).
   */
  onToggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  // Link canônico do “Meu Perfil” (sempre SPA, sem hard reload).
  // Mantém a fonte única (uid -> userId) e não depende de href.
  get myProfileLink(): any[] {
    const uid = this.userId || this.session.currentAuthUser?.uid || '';
    return uid ? ['/perfil', uid] : ['/perfil'];
  }

  /**
   * Debug “no link” (direto no clique).
   * - Não chama navigate() aqui para evitar dupla navegação (routerLink já navega).
   * - Loga teclas/modo de clique para você diferenciar SPA vs hard reload.
   */
  onMyProfileLinkClick(ev: MouseEvent): void {
    this.onMyProfileClick(); // mantém seu log atual

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

  /**
   * logout()
   * - O que faz: dispara logout via LogoutService e notifica o usuário.
   * - Deve permanecer no navbar? Sim, é ação típica do header.
   * - Observação de “plataformas grandes”:
   *   - notificação aqui ok;
   *   - logging/erro idealmente vai para handler central (GlobalErrorHandler/telemetria).
   */
  logout(): void {
    this.logoutService.logout$().pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.notify.showSuccess('Você saiu da sua conta.');
        // Não navegue aqui: o Orchestrator já navega pra /login
      },
      error: (error) => {
        this.logNavbar('logout error', { error });
        // eslint-disable-next-line no-console
        console.error('[NavbarComponent] Erro no logout:', error);
        this.notify.showError('Não foi possível sair agora. Tente novamente.');
      }
    });
  }
} // Linha 627 - devo buscar redução de tarefas aqui
