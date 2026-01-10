// src/app/core/services/autentication/social-auth.service.ts
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Auth } from '@angular/fire/auth';
import { Observable, from, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

import { FirestoreService } from '../data-handling/legacy/firestore.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

@Injectable({ providedIn: 'root' })
export class SocialAuthService {
  constructor(
    private readonly auth: Auth,
    private readonly firestoreService: FirestoreService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly router: Router
  ) { }

  googleLogin(): Observable<IUserDados | null> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    return from(signInWithPopup(this.auth, provider)).pipe(
      switchMap((cred) => {
        const fu = cred.user;
        if (!fu) return of(null);

        const uid = fu.uid;
        const now = Date.now(); // ✅ number (epoch ms)

        return this.firestoreService.getDocument<IUserDados>('users', uid).pipe(
          switchMap((existingUser) => {
            if (!existingUser) {
              // novo usuário
              const payload: IUserRegistrationData = {
                uid,
                email: fu.email || '',
                nickname: '',
                emailVerified: !!fu.emailVerified,
                isSubscriber: false,
                firstLogin: now,
                registrationDate: now,
                latitude: undefined,
                longitude: undefined,
                estado: undefined,
                municipio: undefined,
                gender: undefined,
                orientation: undefined,
                acceptedTerms: { accepted: false, date: now },
                photoURL: fu.photoURL || undefined,
                municipioEstado: undefined,
                // se sua interface tiver esse campo:
                // profileCompleted: false
              };

              return this.firestoreService.saveInitialUserData(uid, payload).pipe(
                map((): IUserDados => ({
                  uid,
                  email: fu.email ?? null,
                  emailVerified: !!fu.emailVerified,
                  nickname: null,
                  photoURL: fu.photoURL ?? null,
                  role: 'free',
                  descricao: '',
                  isSubscriber: false,
                  socialLinks: {},
                  firstLogin: now,
                  lastLogin: now
                })),
                tap(userData => {
                  if (!userData.nickname) this.router.navigate(['/finalizar-cadastro']);
                  else this.router.navigate(['/dashboard/principal']);
                })
              );
            } else {
              // existente: só atualiza lastLogin (number)
              return this.firestoreService
                .updateDocument('users', uid, { lastLogin: now })
                .pipe(
                  map((): IUserDados => ({ ...existingUser, lastLogin: now })),
                  tap(() => {
                    if (!existingUser.nickname || !existingUser.gender) {
                      this.router.navigate(['/finalizar-cadastro']);
                    } else {
                      this.router.navigate(['/dashboard/principal']);
                    }
                  })
                );
            }
          })
        );
      }),
      catchError((err) => {
        this.globalErrorHandler.handleError(err);
        return of(null);
      })
    );
  }

  logout(): Observable<void> {
    return of(void 0);
  }
}
