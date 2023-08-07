// src\app\authentication\register-component\register-component.component.ts

import { Component } from '@angular/core';
import { AuthService } from '../../core/services/autentication/auth.service';

@Component({
  selector: 'app-register-component',
  templateUrl: './register-component.component.html',
  styleUrls: ['./register-component.component.css']
})
export class RegisterComponentComponent {
  email: string = '';
  password: string = '';
  role: 'xereta' | 'animando' | 'decidido' | 'articulador' | 'extase' = 'xereta'; // role padrão

  constructor(private authService: AuthService) { }

  register() {
    this.authService.signup(this.email, this.password, this.role)
      .then(result => {
        // Lida com o registro bem-sucedido
      })
      .catch(error => {
        // Lida com erros de registro
      });
  }

  // Método para atualizar o role
  updateRole(newRole: 'xereta' | 'animando' | 'decidido' | 'articulador' | 'extase') {
    const userId: string = ''; // Aqui, você precisa obter o ID do usuário de alguma forma.
    this.authService.updateUserRole(userId, newRole)
      .then(() => {
        this.role = newRole; // Atualiza a propriedade role do componente
      })
      .catch(error => {
        // Lida com erros de atualização
      });
  }
}
