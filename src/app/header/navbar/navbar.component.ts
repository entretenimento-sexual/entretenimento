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
  // Indica se o usuário está autenticado.
  public isAuthenticated: boolean = false;  // Armazena o nome do usuário para exibição.
  public userName: string = '';   // Subscription para acompanhar mudanças nos dados do usuário.
  private userSubscription?: Subscription;   // Indica se o usuário possui o role "free".
  public isFree: boolean = false;
  public userId: string = '';

  constructor(private authService: AuthService,
              private userProfileService: UserProfileService,
              private router: Router,
              private sidebarService: SidebarService
              ) { }

  ngOnInit(): void {
    // Quando o componente é inicializado, nós nos inscrevemos para ouvir as mudanças nos dados do usuário.
    this.userSubscription = this.authService.user$.subscribe(user => {
      // Define isAuthenticated como verdadeiro se o usuário existir.
      this.isAuthenticated = !!user;

      if (user) {
        this.userName = user.displayName || 'Usuário';// Se o usuário existir, extraia o nome para exibição.
        this.userId = user.uid || '';// Assumindo que seu objeto 'user' tenha uma propriedade 'id'.
        this.isFree = user.role === 'free';// Define isFree como verdadeiro se o role do usuário for 'free'.
      }
    });
  }

  ngOnDestroy(): void {
    // Quando o componente é destruído, encerramos a assinatura para evitar vazamentos de memória.
    this.userSubscription?.unsubscribe();
  }

  // Método para fazer login com o Google.
  /* loginComGoogle(): void {
    this.authService.googleLogin();
  }
 */
  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        if (this.userId) {
          // Atualiza o estado online do usuário para falso
          this.userProfileService.atualizarEstadoOnlineUsuario(this.userId, false)
            .then(() => console.log("Estado online atualizado para offline"))
            .catch((error) => console.error("Erro ao atualizar o estado online", error));
        }
        this.router.navigate(['/login']);
      },
      error: (error) => console.error('Erro ao fazer logout:', error)
    });
  }

  onToggleSidebar(): void {
    console.log("onToggleSidebar chamado!");
    this.sidebarService.toggleSidebar();
  }
}
