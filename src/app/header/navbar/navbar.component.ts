//src\app\header\navbar\navbar.component.ts
import { Component, OnDestroy, OnInit, signal, Signal, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';

@Component({
    selector: 'app-navbar',
    templateUrl: './navbar.component.html',
    styleUrls: ['./navbar.component.css'],
    standalone: false
})

export class NavbarComponent implements OnInit, OnDestroy {
  public isAuthenticated: boolean = false;
  public nickname: string = '';
  public photoURL: string = '';
  public isFree: boolean = false;
  public userId: string = '';
  public isLoginPage: boolean = false;

  private userSubscription?: Subscription;

  readonly isDarkMode: WritableSignal<boolean> = signal(false);

  constructor(
    private authService: AuthService,
    private router: Router,
    private sidebarService: SidebarService
  ) { }

  ngOnInit(): void {
    this.userSubscription = this.authService.user$.subscribe(user => {
      this.isAuthenticated = !!user;
      if (user) {
        this.nickname = user.nickname || 'Usuário';
        this.photoURL = user.photoURL || '';
        this.userId = user.uid;
      } else {
        this.nickname = '';
        this.photoURL = '';
        this.userId = '';
      }
    });

    this.router.events.subscribe(() => {
      this.isLoginPage = this.router.url === '/login';
    });

    // Inicializa o tema baseado no localStorage
    const storedTheme = localStorage.getItem('theme');
    const dark = storedTheme === 'dark';
    this.setDarkMode(dark);
    this.isDarkMode.set(dark);
    }

  toggleDarkMode(): void {
    const newValue = !this.isDarkMode();
    this.setDarkMode(newValue);
    localStorage.setItem('theme', newValue ? 'dark' : 'light');
    this.isDarkMode.set(newValue);
  }

  private setDarkMode(enable: boolean): void {
    const root = document.documentElement;
    root.classList.toggle('dark-mode', enable); // forma enxuta
  }

  ngOnDestroy(): void {
    // Desinscreve a assinatura para evitar vazamentos de memória
    this.userSubscription?.unsubscribe();
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
