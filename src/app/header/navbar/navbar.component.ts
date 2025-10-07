// src/app/header/navbar/navbar.component.ts
import { Component, Injector, OnDestroy, OnInit, runInInjectionContext } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, combineLatest, Observable } from 'rxjs';
import { filter, startWith, map, distinctUntilChanged } from 'rxjs/operators';

import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';

import { Auth, user } from '@angular/fire/auth';
import type { User } from 'firebase/auth';

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
  public isFree = false;
  public userId = '';
  public isLoginPage = false;

  // === Tema/Acessibilidade (fonte de verdade do app) ===
  private _isDarkModeActive = false;
  private _isHighContrastActive = false;

  // Getters usados no template
  isDarkMode(): boolean { return this._isDarkModeActive; }
  isHighContrast(): boolean { return this._isHighContrastActive; }

  private subs = new Subscription();
  private prefersDarkMql?: MediaQueryList;
  private prefersDarkListener?: (ev: MediaQueryListEvent) => void;

  constructor(
    private auth: Auth,
    private injector: Injector,
    private authService: AuthService,
    private router: Router,
    private sidebarService: SidebarService
  ) { }

  private authState$(): Observable<User | null> {
    return runInInjectionContext(this.injector, () => user(this.auth))
      .pipe(startWith(this.auth.currentUser));
  }

  ngOnInit(): void {
    // ====== Sessão/Nav ======
    const combined$ = combineLatest([
      this.authState$(),
      this.authService.user$.pipe(startWith(null))
    ]).pipe(
      map(([fbUser, appUser]) => (fbUser && appUser && fbUser.uid === appUser.uid) ? appUser : null),
      distinctUntilChanged((a: any, b: any) =>
        (a?.uid === b?.uid) && (a?.nickname === b?.nickname) && (a?.photoURL === b?.photoURL)
      )
    );

    this.subs.add(
      combined$.subscribe(user => {
        this.isAuthenticated = !!user;
        this.nickname = user?.nickname || '';
        this.photoURL = user?.photoURL || '';
        this.userId = user?.uid || '';
      })
    );

    this.subs.add(
      this.router.events.pipe(
        filter(e => e instanceof NavigationEnd),
        startWith({} as NavigationEnd)
      ).subscribe(() => {
        this.isLoginPage = this.router.url === '/login';
      })
    );

    // ====== TEMA/CONTRASTE – inicialização única ======
    this.initializeThemes();
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
    this._isDarkModeActive = root.classList.contains('dark-mode');
    this._isHighContrastActive = root.classList.contains('high-contrast');
    this.applyThemeStates(false); // só sincroniza visual; não persiste aqui
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
    console.log('[toggleDarkMode]', this._isDarkModeActive);
    this.applyThemeStates(true);
  }

  toggleHighContrast(): void {
    this._isHighContrastActive = !this._isHighContrastActive;
    console.log('[toggleHighContrast]', this._isHighContrastActive);
    this.applyThemeStates(true);
  }

  resetAppearance(): void {
    // default: claro + HC off
    localStorage.setItem('theme', 'light');
    localStorage.setItem('high-contrast', '0');

    this._isDarkModeActive = false;
    this._isHighContrastActive = false;

    // aplica no DOM sem regravar (já gravamos acima)
    this.applyThemeStates(false);
  }

  // === Outros ===
  logout(): void {
    this.authService.logout().subscribe({
      next: () => console.log('[NavbarComponent] Logout concluído.'),
      error: (error) => console.error('[NavbarComponent] Erro no logout:', error),
    });
  }

  onToggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }
}
