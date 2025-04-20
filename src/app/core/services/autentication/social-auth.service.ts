// src/app/core/services/autentication/social-auth.service.ts
import { Injectable } from '@angular/core';
import { signInWithPopup, GoogleAuthProvider, getAuth, User as FirebaseUser } from 'firebase/auth';
import { Timestamp } from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { switchMap, catchError, tap } from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data'; //👈 import adicionado
import { FirestoreService } from '../data-handling/firestore.service';
import { CacheService } from '../general/cache/cache.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { AuthService } from './auth.service';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root',
})
export class SocialAuthService {
  private auth = getAuth();

  constructor(
    private firestoreService: FirestoreService,
    private cacheService: CacheService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private authService: AuthService,
    private router: Router
  ) { }

  /**
   * Método para login com Google com fluxo integrado ao projeto.
   */
  googleLogin(): Observable<IUserDados | null> {
    const provider = new GoogleAuthProvider();

    return from(signInWithPopup(this.auth, provider)).pipe(
      switchMap((result) => {
        const firebaseUser: FirebaseUser | null = result.user;
        if (!firebaseUser) {
          return of(null);
        }

        return this.firestoreService.getDocument<IUserDados>('users', firebaseUser.uid).pipe(
          switchMap((existingUser) => {
            const now = Timestamp.fromDate(new Date());

            const userRegistrationData: IUserRegistrationData = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              nickname: existingUser?.nickname || '', // Futura definição pelo usuário
              emailVerified: firebaseUser.emailVerified,
              isSubscriber: existingUser?.isSubscriber || false,
              firstLogin: existingUser?.firstLogin || now,
              registrationDate: existingUser?.createdAt || now,
              latitude: existingUser?.latitude,
              longitude: existingUser?.longitude,
              estado: existingUser?.estado,
              municipio: existingUser?.municipio,
              gender: existingUser?.gender,
              orientation: existingUser?.orientation,
              acceptedTerms: {
                accepted: true,
                date: now
              },
              photoURL: existingUser?.photoURL || firebaseUser.photoURL || undefined,
              municipioEstado: existingUser?.municipio && existingUser?.estado
                ? `${existingUser.municipio} - ${existingUser.estado}`
                : undefined
            };

            return this.firestoreService.saveInitialUserData(firebaseUser.uid, userRegistrationData).pipe(
              tap(() => {
                const userData: IUserDados = {
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  emailVerified: firebaseUser.emailVerified,
                  nickname: existingUser?.nickname || null,
                  photoURL: existingUser?.photoURL || firebaseUser.photoURL || null,
                  role: existingUser?.role || 'free',
                  descricao: existingUser?.descricao || '',
                  isSubscriber: existingUser?.isSubscriber || false,
                  socialLinks: existingUser?.socialLinks || {},
                  firstLogin: existingUser?.firstLogin || now,
                  lastLogin: now
                };

                this.cacheService.setUser(firebaseUser.uid, userData);
                this.authService.setCurrentUser(userData);
              }),
              switchMap(() => {
                if (!existingUser?.nickname) {
                  this.router.navigate(['/finalizar-cadastro']);
                } else {
                  this.router.navigate(['/dashboard/principal']);
                }
                return of(existingUser);
              })
            );
          })
        );
      }),
      catchError((error) => {
        this.globalErrorHandler.handleError(error);
        return of(null);
      })
    );
  }

  logout(): Observable<void> {
    return this.authService.logout();
  }
}
