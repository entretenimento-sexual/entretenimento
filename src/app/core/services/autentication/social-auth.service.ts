// src/app/core/services/autentication/social-auth.service.ts
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Auth } from '@angular/fire/auth';
import { Timestamp } from 'firebase/firestore';
import { Observable, from, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

import { FirestoreService } from '../data-handling/firestore.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

@Injectable({ providedIn: 'root' })
export class SocialAuthService {
  constructor(
    private readonly auth: Auth,                        // ✅ injeta Auth do AngularFire
    private readonly firestoreService: FirestoreService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly router: Router
  ) { }

  /**
   * Login com Google.
   * Retorna o usuário consolidado (IUserDados) ou null em caso de erro/cancelamento.
   * O AuthService (via authState) cuidará de “setar” o usuário no estado.
   */
  googleLogin(): Observable<IUserDados | null> {
    const provider = new GoogleAuthProvider();
    // opcional: forçar seleção de conta
    provider.setCustomParameters({ prompt: 'select_account' });

    return from(signInWithPopup(this.auth, provider)).pipe(
      switchMap((cred) => {
        const fu = cred.user;
        if (!fu) return of(null);

        const uid = fu.uid;
        const now = Timestamp.fromDate(new Date());

        return this.firestoreService.getDocument<IUserDados>('users', uid).pipe(
          switchMap((existingUser) => {
            if (!existingUser) {
              // Novo usuário: salva inicial
              const payload: IUserRegistrationData = {
                uid,
                email: fu.email || '',
                nickname: '',                         // será escolhido depois
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
                acceptedTerms: { accepted: false, date: now }, // ⚠️ Em geral não marcar true sem o consentimento explícito
                photoURL: fu.photoURL || undefined,
                municipioEstado: undefined
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
                  // Navega conforme perfil completo ou não
                  if (!userData.nickname) this.router.navigate(['/finalizar-cadastro']);
                  else this.router.navigate(['/dashboard/principal']);
                })
              );
            } else {
              // Usuário existente: apenas atualiza o lastLogin
              return this.firestoreService
                .updateDocument('users', uid, { lastLogin: now })
                .pipe(
                  map((): IUserDados => ({
                    ...existingUser,
                    lastLogin: now
                  })),
                  tap(userData => {
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
    // deixe o AuthService cuidar do fluxo unificado de logout/presença
    // (ele já está injetado e pronto para isso)
    // Importante: não chamar getAuth() direto aqui.
    // Apenas delega:
    return of(void 0); // ajuste futuramente para delegar ao AuthService se quiser
  }
}
