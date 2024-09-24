//src\app\header\navbar\navbar.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})

export class NavbarComponent implements OnInit, OnDestroy {
  public isAuthenticated: boolean = false;
  public userName: string = '';
  private userSubscription?: Subscription;
  public isFree: boolean = false;
  public userId: string = '';
  public isLoginPage: boolean = false;

  constructor(
    private authService: AuthService,
    private userProfileService: UserProfileService,
    private router: Router,
    private sidebarService: SidebarService
  ) { }

  ngOnInit(): void {
    console.log("NavbarComponent ngOnInit chamado");

    if (!this.userSubscription) {
      this.userSubscription = this.authService.user$.subscribe(user => {
        console.log("NavbarComponent: Subscription acionada", user);

        if (user === null) {
          this.isAuthenticated = false;
          console.log("NavbarComponent: Usuário não autenticado, redirecionando para login");
          if (this.router.url !== '/login') {
            this.router.navigate(['/login']);
          }
        } else {
          this.isAuthenticated = true;
          console.log("NavbarComponent: Usuário autenticado", user);
          this.userName = user?.displayName || 'Usuário';
          this.userId = user?.uid || '';
        }
      });
    }

    // Verificar se estamos na página de login
    this.router.events.subscribe(() => {
      this.isLoginPage = this.router.url === '/login';
    });
  }

  ngOnDestroy(): void {
    console.log("NavbarComponent ngOnDestroy chamado");
    // Quando o componente é destruído, encerramos a assinatura para evitar vazamentos de memória.
    this.userSubscription?.unsubscribe();
  }

  logout(): void {
    console.log("NavbarComponent: Logout chamado");
    this.authService.logout().subscribe({
      next: () => {
        if (this.userId) {
          // Atualiza o estado online do usuário para falso
          this.userProfileService.atualizarEstadoOnlineUsuario(this.userId, false)
            .then(() => {
              console.log("Estado online atualizado para offline");
              this.router.navigate(['/login']);  // Mova o redirecionamento para dentro do then
            })
            .catch((error) => console.error("Erro ao atualizar o estado online", error));
        } else {
          console.log("Nenhum usuário logado, redirecionando para login");
          this.router.navigate(['/login']);  // Redirecione para a página de login aqui também
        }
      },
      error: (error) => console.error('Erro ao fazer logout:', error)
    });
  }

  onToggleSidebar(): void {
    console.log("onToggleSidebar chamado!");
    this.sidebarService.toggleSidebar();
  }
}
