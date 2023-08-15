// src\app\core\header\user-icon\user-icon.component.ts
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router'; // Importe o Router
import { AuthService } from '../../services/autentication/auth.service';

@Component({
  selector: 'app-user-icon',
  templateUrl: './user-icon.component.html',
  styleUrls: ['./user-icon.component.css']
})
export class UserIconComponent implements OnInit {
  userProfile: any;

  constructor(
    public authService: AuthService,
    private router: Router  // Injete o Router
  ) { }

  ngOnInit(): void {
    this.setUserProfile();
  }

  setUserProfile(): void {
    if (this.authService.isLoggedIn()) {
      this.userProfile = this.authService.getUserProfile();
    } else {
      this.userProfile = null;
    }
  }

  logout(): void {
    this.authService.logout();
    this.setUserProfile();  // Atualiza o userProfile após o logout
  }

  showLoginModal: boolean = false;

  openLoginModal(): void {
    this.showLoginModal = true;
  }

  navigateToLogin(): void {
    this.router.navigate(['/login']);
  }

  navigateToSpy(): void {
    this.router.navigate(['/espiar']);
  }

  navigateToRegister(): void {
    this.router.navigate(['/register-component']);  // ajuste a rota para sua página de registro
  }

  navigateToEmailPasswordLogin(): void {
    this.router.navigate(['/email-password-login']);  // ajuste a rota para a página de login por email e senha
  }
}
