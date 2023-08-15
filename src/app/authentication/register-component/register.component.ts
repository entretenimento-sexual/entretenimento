// src\app\authentication\register-component\register-component.ts
import { Component } from '@angular/core';
import { AuthService } from '../../core/services/autentication/auth.service';

@Component({
  selector: 'app-register-component',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
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
  async updateRole(newRole: 'xereta' | 'animando' | 'decidido' | 'articulador' | 'extase') {
    try {
      const userId = await this.authService.getUserId();
      if (userId) {
        await this.authService.updateUserRole(userId, newRole);
        this.role = newRole; // Atualiza a propriedade role do componente
      } else {
        throw new Error('User ID not found.');
      }
    } catch (error) {
      // Lida com erros de atualização
      console.error("Erro ao atualizar o role:", error);
    }
  }
}
