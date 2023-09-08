// src\app\core\services\autentication\auth.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, from, Observable, of } from 'rxjs';
import { catchError, tap, map } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Router } from '@angular/router';

import { initializeApp } from 'firebase/app';
import { getAuth, signOut, User, createUserWithEmailAndPassword, sendEmailVerification, applyActionCode } from 'firebase/auth';
import { getFirestore, doc, setDoc, Timestamp, collection, query, where, getDocs, getDoc } from 'firebase/firestore';

import { environment } from 'src/environments/environment';

// Inicialização do Firebase
const app = initializeApp(environment.firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // BehaviorSubject para manter o estado do usuário
  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor(private router: Router) {
    // Inicializa o ouvinte de estado de autenticação
    this.initAuthStateListener();
  }
  // Inicializa um listener para observar mudanças no estado de autenticação do usuário
  private initAuthStateListener(): void {
    auth.onAuthStateChanged(user => {
      console.log('Estado da autenticação mudou:', user);
      this.userSubject.next(this.mapUserToUserDados(user));
    });
  }
  // Converte o objeto User do Firebase para o objeto IUserDados
  private mapUserToUserDados(user: User | null): IUserDados | null {
    if (!user) return null;

    const now = new Date();
    const timestampNow = Timestamp.fromDate(now);  // Convertendo para Timestamp

    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      role: 'xereta',
      lastLoginDate: timestampNow,  // Usando Timestamp
      firstLogin: timestampNow  // Usando Timestamp
    };
  }

  async register(email: string, password: string, nickname: string = ''): Promise<void> {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      if (user) {

        await sendEmailVerification(user, {
          url: 'http://localhost:4200/email-verified'
        });

        // Não salvamos os dados no Firestore aqui. Apenas enviamos o e-mail de verificação.

        console.log('Usuário registrado e e-mail de verificação enviado:', user);
      }
    } catch (error) {
      console.error('Erro ao registrar usuário:', error);
      throw error;
    }
  }


  async checkIfNicknameExists(nickname: string): Promise<boolean> {
    try {
      // Define a coleção e a consulta
      const userCollection = collection(db, 'users');
      const q = query(userCollection, where('nickname', '==', nickname));

      // Executa a consulta
      const querySnapshot = await getDocs(q);

      // Verifica se o apelido já existe
      if (querySnapshot.size > 0) {
        return true; // O apelido já existe
      } else {
        return false; // O apelido está disponível
      }
    } catch (error) {
      console.error('Erro ao verificar a existência do apelido:', error);
      throw error; // Re-lança o erro
    }
  }

  // Método para deslogar o usuário
  logout(): Observable<void> {
    return from(signOut(auth)).pipe(
      tap(() => {
        this.userSubject.next(null);
        console.log('Usuário deslogado com sucesso.');
      }),
      catchError(error => {
        console.error('Erro ao deslogar:', error);
        return of(undefined);
      })
    );
  }

  // Verifica se o usuário está autenticado
  isUserAuthenticated(): boolean {
    return !!this.userSubject.value;
  }

  // Retorna os dados do usuário atual
  get currentUser(): IUserDados | null {
    return this.userSubject.value;
  }

  async handleEmailVerification(actionCode: string, continueUrl: string = '', lang: string = 'pt'): Promise<boolean> {
    if (!actionCode) {
      console.error("ActionCode não fornecido.");
      return false;
    }
    console.log("ActionCode recebido:", actionCode);
    console.log("ContinueUrl recebido:", continueUrl);
    console.log("Lang recebido:", lang);

    try {
      await applyActionCode(auth, actionCode);
      // Endereço de e-mail foi verificado
      console.log('A verificação do e-mail foi bem-sucedida.');

      const user = auth.currentUser;
      if (user) {
        const userData = {
          uid: user.uid,
          email: user.email,
          role: 'animado',
          createdAt: Timestamp.fromDate(new Date())
          // outras informações que você queira salvar, como nickname.
          // (certifique-se de que o nickname ainda esteja disponível)
        };

        // Salvando no Firestore após verificação de e-mail
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, userData, { merge: true });
        console.log('Dados do usuário salvos no Firestore após a verificação do e-mail.');
      }

      return true;
    } catch (error) {
      console.error('Erro ao aplicar o código de ação:', error);
      return false;
    }
  }

  async getUserById(uid: string): Promise<IUserDados | null> {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnapshot = await getDoc(userRef);  // Aqui, use getDoc em vez de getDocs
      if (!userSnapshot.exists()) {
        console.log('Nenhum usuário encontrado com o uid:', uid);
        return null;
      }
      return userSnapshot.data() as IUserDados;
    } catch (error) {
      console.error('Erro ao obter usuário por uid:', error);
      throw error;
    }
  }

}

