//src\app\header\navbar\navbar.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';import { LoginService } from 'src/app/core/services/autentication/login.service';
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
  private userSubscription?: Subscription;
  public isFree: boolean = false;
  public userId: string = '';
  public isLoginPage: boolean = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private sidebarService: SidebarService
  ) { }

  ngOnInit(): void {
    // Assina as mudanças no estado de autenticação
    this.userSubscription = this.authService.user$.subscribe(user => {
      this.isAuthenticated = !!user;
      if (user) {
        this.nickname = user.nickname || 'Usuário';
        this.photoURL = user.photoURL || ''; // Foto do usuário
        this.userId = user.uid;
      } else {
        this.nickname = '';
        this.photoURL = '';
        this.userId = '';
      }
    });

    // Verifica se estamos na página de login
    this.router.events.subscribe(() => {
      this.isLoginPage = this.router.url === '/login';
    });
  }

  ngOnDestroy(): void {
    // Desinscreve a assinatura para evitar vazamentos de memória
    this.userSubscription?.unsubscribe();
  }

  logout(): void {
    console.log('[NavbarComponent] Botão "Sair" clicado. Iniciando logout...');

    this.authService.logout().subscribe({
      next: () => console.log('[NavbarComponent] Logout concluído com sucesso.'),
      error: (error) => console.error('[NavbarComponent] Erro ao fazer logout:', error),
    });
  }

  onToggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }
}
