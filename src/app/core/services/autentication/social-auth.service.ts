// src\app\core\services\autentication\social-auth.service.ts
import { Injectable } from '@angular/core';
import { signInWithPopup, GoogleAuthProvider, getAuth, User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, Timestamp } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { initializeApp } from 'firebase/app';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { switchMap, map, catchError } from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// Inicialização do Firebase
const app = initializeApp(environment.firebase);
const auth = getAuth(app);
const db = getFirestore(app);

@Injectable({
  providedIn: 'root',
})
export class SocialAuthService {
  private userSubject: BehaviorSubject<IUserDados | null> = new BehaviorSubject<IUserDados | null>(null);
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor() {
    this.monitorAuthState();
  }

  /**
   * Monitora mudanças no estado de autenticação
   */
  private monitorAuthState(): void {
    onAuthStateChanged(auth, (user: FirebaseUser | null) => {
      if (user) {
        this.getUserDataFromFirestore(user.uid).subscribe({
          next: (userData) => this.userSubject.next(userData),
          error: (err) => console.error('Erro ao buscar dados do usuário:', err),
        });
      } else {
        this.userSubject.next(null);
      }
    });
  }

  /**
   * Login com Google e retorna um Observable
   */
  googleLogin(): Observable<IUserDados | null> {
    const provider = new GoogleAuthProvider();
    return from(signInWithPopup(auth, provider)).pipe(
      switchMap((result) => {
        const user = result.user;
        if (user) {
          return this.getUserDataFromFirestore(user.uid).pipe(
            switchMap((userData) => {
              const updatedUserData: IUserDados = {
                uid: user.uid,
                email: user.email,
                nickname: userData?.nickname || null, // Recupera nickname do Firestore
                photoURL: user.photoURL,
                role: userData?.role || 'free',
                lastLogin: Timestamp.fromDate(new Date()),
                firstLogin: userData?.firstLogin || Timestamp.fromDate(new Date()),
                descricao: userData?.descricao || '',
                isSubscriber: userData?.isSubscriber || false,
                socialLinks: {
                  facebook: userData?.socialLinks?.facebook || '',
                  instagram: userData?.socialLinks?.instagram || '',
                  buupe: userData?.socialLinks?.buupe || '',
                }
              };

              return this.saveUserDataToFirestore(updatedUserData).pipe(
                map(() => {
                  this.userSubject.next(updatedUserData);
                  return updatedUserData;
                })
              );
            })
          );
        } else {
          return of(null);
        }
      }),
      catchError((error) => {
        console.error('Erro ao fazer login com o Google:', error);
        return of(null);
      })
    );
  }

  /**
   * Busca os dados do Firestore
   */
  private getUserDataFromFirestore(uid: string): Observable<IUserDados | null> {
    const userRef = doc(db, 'users', uid);
    return from(getDoc(userRef)).pipe(
      map((docSnap) => (docSnap.exists() ? (docSnap.data() as IUserDados) : null)),
      catchError((error) => {
        console.error('Erro ao buscar dados do Firestore:', error);
        return of(null);
      })
    );
  }

  /**
   * Salva os dados do usuário no Firestore
   */
  private saveUserDataToFirestore(userData: IUserDados): Observable<void> {
    const userRef = doc(db, 'users', userData.uid);
    return from(setDoc(userRef, userData, { merge: true })).pipe(
      catchError((error) => {
        console.error('Erro ao salvar dados no Firestore:', error);
        throw error;
      })
    );
  }

  /**
   * Logout
   */
  logout(): Observable<void> {
    return from(auth.signOut()).pipe(
      map(() => this.userSubject.next(null)),
      catchError((error) => {
        console.error('Erro ao fazer logout:', error);
        throw error;
      })
    );
  }
}
