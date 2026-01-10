// src/app/header/navbar/navbar.component.ts
import { Component, Injector, OnDestroy, OnInit, runInInjectionContext, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, combineLatest, Observable } from 'rxjs';
import { filter, startWith, map, distinctUntilChanged, shareReplay } from 'rxjs/operators';

import { SidebarService } from 'src/app/core/services/sidebar.service';

// 🔄 Nova base de sessão/usuário (substitui anterior):
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
// ⛔️ SUPRIMIDO: AccessControlService (não estava sendo usado)

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { Auth, user as afUser } from '@angular/fire/auth';
import type { User } from 'firebase/auth';
import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
  standalone: false
})
export class NavbarComponent implements OnInit, OnDestroy {
  // Estado exposto ao template
  public isAuthenticated = false;
  public nickname = '';
  public photoURL = '';
  public userId = '';
  public isLoginPage = false;

  // Mostra banner/upsell ao visitante e plano free
  public isFree = false;

  // === Tema/Acessibilidade ===
  private _isDarkModeActive = false;
  private _isHighContrastActive = false;

  // Getters usados no template (mantidos)
  isDarkMode(): boolean { return this._isDarkModeActive; }
  isHighContrast(): boolean { return this._isHighContrastActive; }

  private subs = new Subscription();
  private prefersDarkMql?: MediaQueryList;
  private prefersDarkListener?: (ev: MediaQueryListEvent) => void;

  // Injeções
  private readonly auth = inject(Auth);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly sidebarService = inject(SidebarService);

  // 🔄 Novos serviços no lugar do Service anterior
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);

  // Feedback robusto (toasts/snack)
  private readonly notify = inject(ErrorNotificationService);

  // ===== Streams base (Firebase Auth e user app) =====
  private authState$(): Observable<User | null> {
    return runInInjectionContext(this.injector, () => afUser(this.auth))
      .pipe(startWith(this.auth.currentUser), shareReplay(1));
  }

  private appUser$(): Observable<IUserDados | null | undefined> {
    // user$ emite undefined durante resolução inicial → normalizamos com startWith
    return this.currentUserStore.user$.pipe(startWith(undefined), shareReplay(1));
  }

  ngOnInit(): void {
    // ===== ViewModel reativo do navbar =====
    const vm$ = combineLatest([this.authState$(), this.appUser$()]).pipe(
      map(([fbUser, appUser]) => {
        // Caso appUser ainda não tenha vindo mas há fbUser, monta um "mínimo"
        const fallback: Partial<IUserDados> | null = fbUser ? {
          uid: fbUser.uid,
          email: fbUser.email ?? '',
          nickname: fbUser.displayName ?? (fbUser.email ? fbUser.email.split('@')[0] : ''),
          emailVerified: !!fbUser.emailVerified
        } : null;

        const u = (appUser ?? fallback) as IUserDados | null;
        const isAuth = !!fbUser && !!u;
        const role = (u as any)?.role ?? (isAuth ? 'basico' : 'visitante');

        return {
          isAuthenticated: isAuth,
          nickname: u?.nickname || '',
          photoURL: (u as any)?.photoURL || '',
          uid: u?.uid || '',
          // visitante (não logado) OU plano 'free' → verdadeiro
          isFree: !isAuth || role === 'free'
        };
      }),
      distinctUntilChanged((a, b) =>
        a.isAuthenticated === b.isAuthenticated &&
        a.nickname === b.nickname &&
        a.photoURL === b.photoURL &&
        a.uid === b.uid &&
        a.isFree === b.isFree
      ),
      shareReplay(1)
    );

    this.subs.add(
      vm$.subscribe(vm => {
        this.isAuthenticated = vm.isAuthenticated;
        this.nickname = vm.nickname;
        this.photoURL = vm.photoURL;
        this.userId = vm.uid;
        this.isFree = vm.isFree;
      })
    );

    // ===== Route watcher =====
    this.subs.add(
      this.router.events.pipe(
        filter(e => e instanceof NavigationEnd),
        startWith({} as NavigationEnd)
      ).subscribe(() => {
        this.isLoginPage = this.router.url === '/login';
      })
    );

    // ===== TEMA/CONTRASTE – inicialização e preferências do SO =====
    this.initializeThemes();
    this.bindSystemPrefersDark();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.prefersDarkMql && this.prefersDarkListener) {
      this.prefersDarkMql.removeEventListener('change', this.prefersDarkListener);
    }
  }

  // =========================
  //    THEME STATE MACHINE
  // =========================
  private initializeThemes(): void {
    const root = document.documentElement;

    // restaura preferências persistidas
    const persistedTheme = localStorage.getItem('theme'); // 'dark' | 'light' | null
    const persistedHc = localStorage.getItem('high-contrast'); // '1' | '0' | null

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

    this.applyThemeStates(false); // sincroniza sem persistir novamente
  }

  private bindSystemPrefersDark(): void {
    // Se o usuário ainda não escolheu tema, siga o SO
    const userChose = localStorage.getItem('theme') !== null;
    if (userChose) return;

    try {
      this.prefersDarkMql = window.matchMedia?.('(prefers-color-scheme: dark)');
      if (this.prefersDarkMql) {
        // aplica estado inicial
        this._isDarkModeActive = !!this.prefersDarkMql.matches;
        this.applyThemeStates(false);

        // reage a mudanças do SO
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
    // padrão: claro + HC off
    localStorage.setItem('theme', 'light');
    localStorage.setItem('high-contrast', '0');

    this._isDarkModeActive = false;
    this._isHighContrastActive = false;
    this.applyThemeStates(false);
  }

  // === Outros ===
  onToggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  logout(): void {
    this.session.signOut$().subscribe({
      next: () => {
        // Navegação pós-logout coesa com grandes plataformas
        this.notify.showSuccess('Você saiu da sua conta.');
        this.router.navigate(['/login'], { replaceUrl: true }).catch(() => { });
      },
      error: (error) => {
        // Tratamento centralizado + mensagem amigável
        console.error('[NavbarComponent] Erro no logout:', error);
        this.notify.showError('Não foi possível sair agora. Tente novamente.');
      }
    });
  }
}
