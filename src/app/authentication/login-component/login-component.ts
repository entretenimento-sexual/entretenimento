// src\app\authentication\login-component\login-component.component.ts
import { Component } from '@angular/core';
import { AuthService } from '../../core/services/autentication/auth.service';

@Component({
  selector: 'app-login-component',
  templateUrl: './login-component.html',
  styleUrls: ['./login-component.css']
})
export class LoginComponent {
  email: string = '';
  password: string = '';

  constructor(private authService: AuthService) { }

  login() {
    this.authService.login(this.email, this.password)
      .then(result => {
        // Lida com o login bem-sucedido
      })
      .catch(error => {
        // Lida com erros de login
      });
  }
}

