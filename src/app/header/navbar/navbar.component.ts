//src\app\header\navbar\navbar.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';


@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})

export class NavbarComponent implements OnInit, OnDestroy {
  // Indica se o usuário está autenticado.
  public isAuthenticated: boolean = false;  // Armazena o nome do usuário para exibição.
  public userName: string = '';   // Subscription para acompanhar mudanças nos dados do usuário.
  private userSubscription?: Subscription;   // Indica se o usuário possui o role "xereta".
  public isXereta: boolean = false;
  public userId: string = '';

  constructor(private authService: AuthService, private router: Router) { }

  ngOnInit(): void {
    // Quando o componente é inicializado, nós nos inscrevemos para ouvir as mudanças nos dados do usuário.
    this.userSubscription = this.authService.user$.subscribe(user => {
      // Define isAuthenticated como verdadeiro se o usuário existir.
      this.isAuthenticated = !!user;

      if (user) {
        // Se o usuário existir, extraia o nome para exibição.
        this.userName = user.displayName || 'Usuário';

        // Assumindo que seu objeto 'user' tenha uma propriedade 'id'.
        this.userId = user.uid || '';

        // Define isXereta como verdadeiro se o role do usuário for 'xereta'.
        this.isXereta = user.role === 'xereta';
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
  // Método para fazer logout.
  logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }
}
