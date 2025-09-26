// src/app/header/navbar/navbar.component.ts
import { Component, Injector, OnDestroy, OnInit, runInInjectionContext } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, combineLatest, Observable } from 'rxjs';
import { filter, startWith, map, distinctUntilChanged } from 'rxjs/operators';

import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';

// ✅ As importações e injeções neste arquivo já estavam corretas!
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

  private subs = new Subscription();

  constructor(
    private auth: Auth,
    private injector: Injector,
    private authService: AuthService,
    private router: Router,
    private sidebarService: SidebarService
  ) { }

  // ✅ Uso do 'user(this.auth)' é a melhor prática para obter o estado do usuário.
  private authState$(): Observable<User | null> {
    return runInInjectionContext(this.injector, () => user(this.auth))
      .pipe(startWith(this.auth.currentUser));
  }

  ngOnInit(): void {
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

    const storedTheme = localStorage.getItem('theme');
    this.setDarkMode(storedTheme === 'dark');
  }

  isDarkMode(): boolean {
    return document.documentElement.classList.contains('dark-mode');
  }

  toggleDarkMode(): void {
    const root = document.documentElement;
    const next = !root.classList.contains('dark-mode');
    root.classList.toggle('dark-mode', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  private setDarkMode(enable: boolean): void {
    document.documentElement.classList.toggle('dark-mode', enable);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

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
