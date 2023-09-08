// src\app\authentication\espiar\espiar.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { Subscription } from 'rxjs';
import { SocialAuthService } from 'src/app/core/services/autentication/social-auth.service';

@Component({
  selector: 'app-espiar',
  templateUrl: './espiar.component.html',
  styleUrls: ['./espiar.component.css', '../authentication.css']
})

export class EspiarComponent implements OnInit, OnDestroy {
  public isAuthenticated: boolean = false;
  private userSubscription!: Subscription;

  constructor(private router: Router,
    private authService: SocialAuthService,
  ) { }

  ngOnInit(): void {
    // Inicializa a variável `userSubscription` no construtor
    this.userSubscription = this.authService.user$.subscribe(user => {
      this.isAuthenticated = !!user;

      // Verifica se o usuário já está autenticado
      if (this.isAuthenticated) {
        // Redireciona para o componente ProfileList se o usuário está autenticado
        this.router.navigate(['/profile-list']);
      }
    });
  }

  ngOnDestroy(): void {
    // Desvincula a subscrição `userSubscription`
    this.userSubscription?.unsubscribe();
  }

  loginComGoogle(): void {
    // Verifica se o usuário já está autenticado
    if (!this.isAuthenticated) {
      // Permite que o usuário faça login com o Google
      this.authService.googleLogin().then(() => {
        // Redireciona para o componente ProfileList após o login bem-sucedido
        this.router.navigate(['/profile-list']);
      });
    }
  }

  logout(): void {
    // Verifica se o usuário está autenticado
    if (this.isAuthenticated) {
      // Desloga o usuário
      this.authService.logout().then(() => {
        // Redireciona para a página que você deseja após o logout
        this.router.navigate(['/']);
      }).catch(error => {
        console.error('Erro ao fazer logout:', error);
      });
    }
  }
}
