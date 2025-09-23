//src\app\header\navbar\navbar.component.ts
import { Component, OnDestroy, OnInit, Inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, combineLatest, Observable } from 'rxjs';
import { filter, startWith, map, distinctUntilChanged } from 'rxjs/operators';

import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';

import { FIREBASE_AUTH } from 'src/app/core/firebase/firebase.tokens';
import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';

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
    @Inject(FIREBASE_AUTH) private auth: Auth,   // 👈 usa a mesma instância modular do app
    private authService: AuthService,
    private router: Router,
    private sidebarService: SidebarService
  ) { }

  private authState$(): Observable<User | null> {
    return new Observable<User | null>((obs) => {
      const unsub = onAuthStateChanged(
        this.auth,
        (u) => obs.next(u),
        () => obs.next(null)
      );
      return () => unsub();
    }).pipe(startWith(this.auth.currentUser));
  }

  ngOnInit(): void {
    // 1) Só considera autenticado quando há Firebase user **e** perfil
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

    // 2) Detecta rota /login
    this.subs.add(
      this.router.events.pipe(
        filter(e => e instanceof NavigationEnd),
        startWith({} as NavigationEnd)
      ).subscribe(() => {
        this.isLoginPage = this.router.url === '/login';
      })
    );

    // 3) Dark mode inicial
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
    console.log('[NavbarComponent] Botão "Sair" clicado. Iniciando logout...');
    this.authService.logout().subscribe({
      next: () => console.log('[NavbarComponent] Logout concluído com sucesso.'),
      error: (error) => console.log('[NavbarComponent] Erro ao fazer logout:', error),
    });
  }

  onToggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }
}
