// src/app/core/services/autentication/login.service.ts
import { Injectable } from '@angular/core';
import { Observable, of, from, iif, defer, firstValueFrom } from 'rxjs';
import { catchError, map, switchMap, tap, timeout, retry } from 'rxjs/operators';

import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail as sendPasswordResetEmailFn,
  confirmPasswordReset,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  EmailAuthProvider,
  reauthenticateWithCredential,
  type Persistence,
  Auth,
  type User,
} from '@angular/fire/auth';
import { doc, Timestamp, updateDoc } from '@angular/fire/firestore';

import { GeolocationTrackingService } from '../geolocation/geolocation-tracking.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { AuthService } from './auth.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreService } from '../data-handling/firestore.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { UsuarioService } from '../user-profile/usuario.service';
import { EmailVerificationService } from './register/email-verification.service';

import { environment } from 'src/environments/environment';

export interface LoginResult {
  success: boolean;
  emailVerified?: boolean;
  user?: IUserDados;
  code?: string;
  message?: string;
  needsProfileCompletion?: boolean;
}

@Injectable({ providedIn: 'root' })
export class LoginService {
  private readonly NET_TIMEOUT_MS = 12000;

  constructor(
    private usuarioService: UsuarioService,
    private firestoreService: FirestoreService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private authService: AuthService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private geoloc: GeolocationTrackingService,
    private emailVerificationService: EmailVerificationService,
    // ⬇️ Alinha com AppModule: injete o Auth fornecido por provideAuth(...)
    private auth: Auth,
  ) { }

  setSessionPersistence$(persistence: Persistence): Observable<void> {
    return from(setPersistence(this.auth, persistence)).pipe(
      tap(() => console.log('[LoginService] Persistência de sessão definida.'))
    );
  }

  private minimalFromAuth(u: User): IUserDados {
    return {
      uid: u.uid,
      email: u.email ?? '',
      nickname: u.displayName ?? (u.email ? u.email.split('@')[0] : 'Usuário'),
      emailVerified: !!u.emailVerified,
      isSubscriber: false,
      profileCompleted: false,
      role: 'basico' as any,
    } as IUserDados;
  }

  private syncEmailVerifiedIfNeeded$(
    uid: string,
    nowVerified: boolean,
    userData: IUserDados
  ): Observable<IUserDados> {
    if (!nowVerified || userData.emailVerified === true) return of(userData);
    return this.emailVerificationService.updateEmailVerificationStatus(uid, true).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      catchError(e => { console.log('[LoginService] Sync emailVerified falhou:', e); return of(void 0); }),
      map(() => {
        const patched = { ...userData, emailVerified: true } as IUserDados;
        this.authService.setCurrentUser(patched);
        try { this.firestoreUserQuery.updateUserInStateAndCache(uid, patched); } catch { }
        return patched;
      })
    );
  }

  login$(email: string, password: string, rememberMe?: boolean): Observable<LoginResult> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return of({ success: false, code: 'offline', message: 'Sem conexão com a internet. Verifique sua rede e tente novamente.' });
    }

    const db = this.firestoreService.getFirestoreInstance();

    return iif(
      () => typeof rememberMe === 'boolean',
      this.setSessionPersistence$(rememberMe ? browserLocalPersistence : browserSessionPersistence),
      of(void 0)
    ).pipe(
      switchMap(() => from(signInWithEmailAndPassword(this.auth, email, password))),
      timeout({ each: this.NET_TIMEOUT_MS }),

      switchMap(({ user }) =>
        from(user.reload()).pipe(timeout({ each: this.NET_TIMEOUT_MS }), map(() => user as User))
      ),

      switchMap((refreshed) => {
        if (!refreshed) {
          return of({ success: false, code: 'auth/no-user', message: 'Não foi possível autenticar agora. Tente novamente.' });
        }

        return this.firestoreUserQuery.getUser(refreshed.uid).pipe(
          retry({ count: 2, delay: 200 }),
          timeout({ each: this.NET_TIMEOUT_MS }),
          switchMap((userData) => {
            const effectiveUser: IUserDados = userData ?? this.minimalFromAuth(refreshed);

            this.authService.setCurrentUser(effectiveUser as any);

            defer(() => { this.geoloc.autoStartTracking(refreshed.uid); return of(void 0); })
              .pipe(catchError(() => of(void 0))).subscribe();

            defer(() => updateDoc(doc(db, 'users', refreshed.uid), { lastLogin: Timestamp.fromDate(new Date()) }))
              .pipe(catchError(() => of(void 0))).subscribe();

            try {
              const maybe = (this.usuarioService as any)?.updateUserOnlineStatus?.(refreshed.uid, true);
              if (maybe?.subscribe) (maybe as Observable<unknown>).pipe(catchError(() => of(void 0))).subscribe();
              else from(Promise.resolve(maybe)).pipe(catchError(() => of(void 0))).subscribe();
            } catch { }

            const nowVerified = !!refreshed.emailVerified;

            return this.syncEmailVerifiedIfNeeded$(refreshed.uid, nowVerified, effectiveUser).pipe(
              map(finalUser => ({
                success: true,
                emailVerified: nowVerified,
                user: finalUser,
                needsProfileCompletion:
                  !finalUser.nickname ||
                  (finalUser as any).gender === undefined ||
                  (finalUser as any).gender === '',
              }))
            );
          })
        );
      }),

      catchError((err) => {
        const mapped = this.mapAuthError(err);
        this.globalErrorHandler.handleError(new Error(mapped.message));
        return of({ success: false, code: mapped.code, message: mapped.message });
      })
    );
  }

  requestGeolocationOnce$(): Observable<boolean> {
    return defer(() => this.geoloc.requestPermissionOnce()).pipe(
      map((state) => {
        const uid = this.auth.currentUser?.uid;
        if (uid && state === 'granted') { this.geoloc.startTracking(uid); return true; }
        return false;
      })
    );
  }

  sendPasswordReset$(email: string): Observable<void> {
    return from(sendPasswordResetEmailFn(this.auth, email));
  }
  sendPasswordResetEmail$(email: string): Observable<void> { return this.sendPasswordReset$(email); }
  confirmPasswordReset$(oobCode: string, newPassword: string): Observable<void> {
    return from(confirmPasswordReset(this.auth, oobCode, newPassword));
  }
  reauthenticateUser$(password: string): Observable<void> {
    const user = this.auth.currentUser;
    if (!user?.email) return of(void 0);
    const credential = EmailAuthProvider.credential(user.email, password);
    return from(reauthenticateWithCredential(user, credential)).pipe(map(() => void 0));
  }

  // Wrappers Promise
  setSessionPersistence(persistence: Persistence): Promise<void> { return firstValueFrom(this.setSessionPersistence$(persistence)); }
  login(email: string, password: string, rememberMe?: boolean): Promise<LoginResult> { return firstValueFrom(this.login$(email, password, rememberMe)); }
  sendPasswordReset(email: string): Promise<void> { return firstValueFrom(this.sendPasswordReset$(email)); }
  sendPasswordResetEmail(email: string): Promise<void> { return this.sendPasswordReset(email); }
  confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> { return firstValueFrom(this.confirmPasswordReset$(oobCode, newPassword)); }
  reauthenticateUser(password: string): Promise<void> { return firstValueFrom(this.reauthenticateUser$(password)); }

  private mapAuthError(error: any): { code?: string; message: string } {
    const code = error?.code as string | undefined;
    let message = 'Erro ao realizar login. Tente novamente.';
    switch (code) {
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
      case 'auth/INVALID_LOGIN_CREDENTIALS':
      case 'auth/INVALID_PASSWORD':
      case 'auth/EMAIL_NOT_FOUND': message = 'E-mail ou senha incorretos.'; break;
      case 'auth/user-not-found': message = 'Usuário não encontrado. Verifique o e-mail inserido.'; break;
      case 'auth/invalid-email': message = 'Formato de e-mail inválido.'; break;
      case 'auth/user-disabled': message = 'Este usuário foi desativado.'; break;
      case 'auth/too-many-requests': message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'; break;
      case 'auth/network-request-failed':
        if (!environment.production && (environment as any)?.emulators?.auth) {
          const { host, port } = (environment as any).emulators.auth;
          message = `Falha de conexão ao autenticar. Se usa emulador, verifique o Auth Emulator em http://${host}:${port}.`;
        } else {
          message = 'Falha de conexão ao autenticar. Verifique sua internet e tente novamente.';
        }
        break;
      case 'deadline-exceeded': message = 'Tempo de resposta excedido. Tente novamente.'; break;
    }
    return { code, message };
  }
}
