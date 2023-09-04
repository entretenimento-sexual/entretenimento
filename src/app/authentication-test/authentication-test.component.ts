// src\app\authentication-test\authentication-test.component.ts
import { Component } from '@angular/core';
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc } from "firebase/firestore";
import { environment } from '../../environments/environment';

const app = initializeApp(environment.firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

@Component({
  selector: 'app-authentication-test',
  template: '<button (click)="loginWithGoogle()">Login com Google</button>',
})
export class AuthenticationTestComponent {

  async loginWithGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      console.log("Resultado da autenticação:", result);
      const user = result.user;

      // Recuperando o token de acesso do Google
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential) {
        const token = credential.accessToken;
        console.log('Token de acesso do Google:', token);
      }

      if (user) {
        // Estruturação dos dados do usuário para salvar no Firestore
        const userData = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          role: 'xereta',  // Atribui o papel de "xereta" ao usuário
          loginTime: new Date().toISOString()  // Armazena o horário de login
        };
        

        await this.salvarDadosNoFirestore(userData);
      }
    } catch (error) {
      console.error('Erro ao tentar fazer login com o Google:', error);
    }
  }

  async salvarDadosNoFirestore(userData: any) {
    try {
      // Salva o usuário na coleção "users" usando o UID do usuário como o ID do documento
      const userRef = doc(db, "users", userData.uid);
      await setDoc(userRef, userData, { merge: true });
      console.log("Dados do usuário salvos com sucesso");
    } catch (error) {
      console.error("Erro ao salvar dados do usuário:", error);
    }
  }
}
