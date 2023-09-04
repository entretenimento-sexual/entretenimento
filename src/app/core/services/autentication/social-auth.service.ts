// src\app\core\services\autentication\social-auth.service.ts
import { Injectable } from '@angular/core';
import { signInWithPopup, GoogleAuthProvider, getAuth, User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, Timestamp } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { initializeApp } from 'firebase/app';
import { Observable, BehaviorSubject } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados'; // Importe a interface aqui

// Inicialização do Firebase
const app = initializeApp(environment.firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

@Injectable({
  providedIn: 'root',
})
export class SocialAuthService {
  private userSubject: BehaviorSubject<IUserDados | null> = new BehaviorSubject<IUserDados | null>(null);
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor() {
    onAuthStateChanged(auth, (user: FirebaseUser | null) => {
      if (user) {
        const userData: IUserDados = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          role: 'xereta',
          lastLoginDate: Timestamp.fromDate(new Date()),
          firstLogin: Timestamp.fromDate(new Date()) // Este será substituído, se já existir
        };

        this.userSubject.next(userData);
      } else {
        this.userSubject.next(null);
      }
    });
  }

  async googleLogin(): Promise<void> {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      if (user) {
        const userData: IUserDados = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          role: 'xereta',
          lastLoginDate: Timestamp.fromDate(new Date()),
          firstLogin: Timestamp.fromDate(new Date()) // Este será substituído, se já existir
        };

        await this.salvarDadosNoFirestore(userData);
      }
    } catch (error) {
      console.error('Erro ao fazer login com o Google:', error);
    }
  }

  private async salvarDadosNoFirestore(userData: IUserDados): Promise<void> {
    try {
      const userRef = doc(db, 'users', userData.uid);
      const docSnap = await getDoc(userRef);

      if (!docSnap.exists()) {
        userData.firstLogin = Timestamp.fromDate(new Date());
      } else {
        if (docSnap.data() && 'firstLogin' in docSnap.data()) {
          delete userData.firstLogin;
        }
      }

      await setDoc(userRef, userData, { merge: true });
    } catch (error) {
      console.error('Erro ao salvar dados do usuário:', error);
    }
  }

  async logout(): Promise<void> {
    try {
      await auth.signOut();
      this.userSubject.next(null);
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  }
}
