// src\app\authentication\login-component\login-component.component.ts
import { Component } from '@angular/core';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

@Component({
  selector: 'app-login-component',
  templateUrl: './login-component.html',
  styleUrls: ['./login-component.css', '../authentication.css']
})
export class LoginComponent {
  email: string = '';
  password: string = '';

  constructor() { }

  async login(): Promise<void> {
    const auth = getAuth();
    try {
      const userCredential = await signInWithEmailAndPassword(auth, this.email, this.password);
      // O usuário está agora logado
      console.log('Usuário logado com sucesso:', userCredential.user);
    } catch (error) {
      console.error('Erro ao fazer login:', error);
    }
  }
}




