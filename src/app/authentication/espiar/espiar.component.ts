// src\app\authentication\espiar\espiar.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { SocialAuthService } from 'src/app/core/services/autentication/social-auth.service';

@Component({
  selector: 'app-espiar',
  templateUrl: './espiar.component.html',
  styleUrls: ['./espiar.component.css'],
  standalone: false
})
export class EspiarComponent implements OnInit, OnDestroy {
  public isAuthenticated: boolean = false;
  private userSubscription!: Subscription;

  constructor(
    private router: Router,
    private authService: SocialAuthService,
  ) { }

  ngOnInit(): void {
    // Subscreve ao Observable do estado do usuário
    this.userSubscription = this.authService.user$.subscribe(user => {
      this.isAuthenticated = !!user;

      // Redireciona para a lista de perfis se o usuário está autenticado
      if (this.isAuthenticated) {
        this.router.navigate(['/profile-list']);
      }
    });
  }

  ngOnDestroy(): void {
    // Cancela a subscrição ao sair do componente
    this.userSubscription?.unsubscribe();
  }

  loginComGoogle(): void {
    // Verifica se o usuário não está autenticado antes de tentar login
    if (!this.isAuthenticated) {
      this.authService.googleLogin().subscribe({
        next: () => {
          // Redireciona para a lista de perfis após o login
          this.router.navigate(['/profile-list']);
        },
        error: (err) => {
          console.error('Erro ao fazer login com o Google:', err);
        }
      });
    }
  }

  logout(): void {
    // Verifica se o usuário está autenticado antes de tentar logout
    if (this.isAuthenticated) {
      this.authService.logout().subscribe({
        next: () => {
          // Redireciona para a página inicial após o logout
          this.router.navigate(['/']);
        },
        error: (err) => {
          console.error('Erro ao fazer logout:', err);
        }
      });
    }
  }
}
