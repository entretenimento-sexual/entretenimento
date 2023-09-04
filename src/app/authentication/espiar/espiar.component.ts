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
  private userSubscription?: Subscription;

  constructor(private router: Router,
    private authService: SocialAuthService,
    ) { }

  ngOnInit(): void {
    this.userSubscription = this.authService.user$.subscribe(user => {
      this.isAuthenticated = !!user;
      if (this.isAuthenticated) {
        // Redirecionar para o componente ProfileList se o usuário está autenticado
        this.router.navigate(['/profile-list']);
      }
    });
  }

  ngOnDestroy(): void {
    this.userSubscription?.unsubscribe();
  }

  loginComGoogle(): void {
    this.authService.googleLogin().then(() => {
      // Redirecionar para o componente ProfileList após o login bem-sucedido
      this.router.navigate(['/profile-list']);
    });
  }

  logout(): void {
    this.authService.logout().then(() => {
      // Redirecionar para a página que você deseja após o logout
      this.router.navigate(['/']);
    }).catch(error => {
      console.error('Erro ao fazer logout:', error);
    });
  }
}
