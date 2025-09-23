// src/app/core/services/autentication/login.service.ts
import { Injectable, Inject } from '@angular/core';
import { Observable, of, from, iif, defer } from 'rxjs';
import { firstValueFrom } from 'rxjs';
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
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, Timestamp, updateDoc } from 'firebase/firestore';

import { GeolocationTrackingService } from '../geolocation/geolocation-tracking.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { AuthService } from './auth.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreService } from '../data-handling/firestore.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { UsuarioService } from '../user-profile/usuario.service';
import { EmailVerificationService } from './register/email-verification.service';

import { FIREBASE_AUTH } from '../../firebase/firebase.tokens';
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
    @Inject(FIREBASE_AUTH) private auth: Auth,
  ) { }

  /** Define persistência (Local = lembrar / Session = até fechar o browser). */
  setSessionPersistence$(persistence: Persistence): Observable<void> {
    return from(setPersistence(this.auth, persistence)).pipe(
      tap(() => console.log('[LoginService] Persistência de sessão definida.'))
    );
  }

  /** Snapshot mínimo quando ainda não existe doc no Firestore. */
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

  /**
   * Sincroniza emailVerified no Firestore e espelha no estado/cache/store (se virou true).
   * Retorna o usuário (possivelmente patchado com emailVerified=true).
   */
  private syncEmailVerifiedIfNeeded$(
    uid: string,
    nowVerified: boolean,
    userData: IUserDados
  ): Observable<IUserDados> {
    if (!nowVerified || userData.emailVerified === true) {
      return of(userData);
    }
    return this.emailVerificationService.updateEmailVerificationStatus(uid, true).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      catchError((e) => {
        // não derruba o fluxo se falhar — apenas loga
        console.log('[LoginService] Falha ao sincronizar emailVerified no Firestore:', e);
        return of(void 0);
      }),
      map(() => {
        // espelha no estado/cache imediatamente para a UI
        const patched = { ...userData, emailVerified: true } as IUserDados;
        this.authService.setCurrentUser(patched);
        try {
          this.firestoreUserQuery.updateUserInStateAndCache(uid, patched);
        } catch { /* opcional, depende da sua implementação */ }
        return patched;
      })
    );
  }

  /**
   * Login com e-mail/senha:
   * - respeita rememberMe (persistência)
   * - RELOAD do usuário logo após signIn (emailVerified “fresco”)
   * - busca doc no Firestore; se ausente, **NÃO faz logout** → usa usuário mínimo
   * - mantém geoloc/online/lastLogin (best-effort)
   */
  login$(email: string, password: string, rememberMe?: boolean): Observable<LoginResult> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return of({
        success: false,
        code: 'offline',
        message: 'Sem conexão com a internet. Verifique sua rede e tente novamente.',
      });
    }

    const db = this.firestoreService.getFirestoreInstance();

    return iif(
      () => typeof rememberMe === 'boolean',
      this.setSessionPersistence$(rememberMe ? browserLocalPersistence : browserSessionPersistence),
      of(void 0)
    ).pipe(
      // 1) autentica
      switchMap(() => from(signInWithEmailAndPassword(this.auth, email, password))),
      timeout({ each: this.NET_TIMEOUT_MS }),

      // 2) RELOAD do usuário retornado pelo signIn (garante emailVerified atualizado)
      switchMap(({ user }) =>
        from(user.reload()).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          map(() => user as User)
        )
      ),

      // 3) Firestore user (pode não existir logo após cadastro)
      switchMap((refreshed) => {
        if (!refreshed) {
          return of<LoginResult>({
            success: false,
            code: 'auth/no-user',
            message: 'Não foi possível autenticar agora. Tente novamente.',
          });
        }

        return this.firestoreUserQuery.getUser(refreshed.uid).pipe(
          retry({ count: 2, delay: 200 }),
          timeout({ each: this.NET_TIMEOUT_MS }),
          switchMap((userData) => {
            // 🔴 ALTERAÇÃO-CHAVE: NÃO fazemos logout quando userData não existe
            // Hidrata com snapshot mínimo (UI/guard decidirão o fluxo)
            const effectiveUser: IUserDados = userData ?? this.minimalFromAuth(refreshed);

            // 4) centraliza estado (NgRx/cache/heartbeat)
            this.authService.setCurrentUser(effectiveUser as any);

            // 5) geolocalização (best-effort)
            defer(() => {
              this.geoloc.autoStartTracking(refreshed.uid);
              return of(void 0);
            })
              .pipe(catchError(() => of(void 0)))
              .subscribe();

            // 6) analítico: lastLogin (best-effort)
            defer(() =>
              updateDoc(doc(db, 'users', refreshed.uid), { lastLogin: Timestamp.fromDate(new Date()) })
            )
              .pipe(catchError(() => of(void 0)))
              .subscribe();

            // 7) isOnline (best-effort)
            try {
              const maybe = (this.usuarioService as any)?.updateUserOnlineStatus?.(refreshed.uid, true);
              if (maybe?.subscribe) {
                (maybe as Observable<unknown>).pipe(catchError(() => of(void 0))).subscribe();
              } else {
                from(Promise.resolve(maybe)).pipe(catchError(() => of(void 0))).subscribe();
              }
            } catch { /* no-op */ }

            const nowVerified = !!refreshed.emailVerified;

            // 8) sincroniza emailVerified=true no Firestore + estado, se necessário
            return this.syncEmailVerifiedIfNeeded$(refreshed.uid, nowVerified, effectiveUser).pipe(
              map((finalUser) => {
                const needsProfileCompletion =
                  !finalUser.nickname ||
                  (finalUser as any).gender === undefined ||
                  (finalUser as any).gender === '';

                return {
                  success: true,
                  emailVerified: nowVerified,
                  user: finalUser,
                  needsProfileCompletion,
                } as LoginResult;
              })
            );
          })
        );
      }),

      // 9) erros → não força signOut; apenas mapeia mensagem
      catchError((err) => {
        const mapped = this.mapAuthError(err);
        this.globalErrorHandler.handleError(new Error(mapped.message));
        return of({ success: false, code: mapped.code, message: mapped.message } as LoginResult);
      })
    );
  }

  /** Geolocalização on-demand. */
  requestGeolocationOnce$(): Observable<boolean> {
    return defer(() => this.geoloc.requestPermissionOnce()).pipe(
      map((state) => {
        const uid = this.auth.currentUser?.uid;
        if (uid && state === 'granted') {
          this.geoloc.startTracking(uid);
          return true;
        }
        return false;
      })
    );
  }

  sendPasswordReset$(email: string): Observable<void> {
    return from(sendPasswordResetEmailFn(this.auth, email));
  }

  /** alias compat */
  sendPasswordResetEmail$(email: string): Observable<void> {
    return this.sendPasswordReset$(email);
  }

  confirmPasswordReset$(oobCode: string, newPassword: string): Observable<void> {
    return from(confirmPasswordReset(this.auth, oobCode, newPassword));
  }

  reauthenticateUser$(password: string): Observable<void> {
    const user = this.auth.currentUser;
    if (!user?.email) return of(void 0);
    const credential = EmailAuthProvider.credential(user.email, password);
    return from(reauthenticateWithCredential(user, credential)).pipe(map(() => void 0));
  }

  // ---------- Promise wrappers (compat) ----------
  setSessionPersistence(persistence: Persistence): Promise<void> {
    return firstValueFrom(this.setSessionPersistence$(persistence));
  }
  login(email: string, password: string, rememberMe?: boolean): Promise<LoginResult> {
    return firstValueFrom(this.login$(email, password, rememberMe));
  }
  sendPasswordReset(email: string): Promise<void> {
    return firstValueFrom(this.sendPasswordReset$(email));
  }
  sendPasswordResetEmail(email: string): Promise<void> {
    return this.sendPasswordReset(email);
  }
  confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
    return firstValueFrom(this.confirmPasswordReset$(oobCode, newPassword));
  }
  reauthenticateUser(password: string): Promise<void> {
    return firstValueFrom(this.reauthenticateUser$(password));
  }
  requestGeolocationOnce(): Promise<boolean> {
    return firstValueFrom(this.requestGeolocationOnce$());
  }
  // ------------------------------------------------

  private mapAuthError(error: any): { code?: string; message: string } {
    const code = error?.code as string | undefined;
    let message = 'Erro ao realizar login. Tente novamente.';

    switch (code) {
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
      case 'auth/INVALID_LOGIN_CREDENTIALS':
      case 'auth/INVALID_PASSWORD':
      case 'auth/EMAIL_NOT_FOUND':
        message = 'E-mail ou senha incorretos.'; break;
      case 'auth/user-not-found':
        message = 'Usuário não encontrado. Verifique o e-mail inserido.'; break;
      case 'auth/invalid-email':
        message = 'Formato de e-mail inválido.'; break;
      case 'auth/user-disabled':
        message = 'Este usuário foi desativado.'; break;
      case 'auth/too-many-requests':
        message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'; break;
      case 'auth/network-request-failed':
        if (!environment.production && (environment as any)?.emulators?.auth) {
          const { host, port } = (environment as any).emulators.auth;
          message = `Falha de conexão ao autenticar. Se usa emulador, verifique se o Auth Emulator está ativo em http://${host}:${port}.`;
        } else {
          message = 'Falha de conexão ao autenticar. Verifique sua internet e tente novamente.';
        }
        break;
      case 'deadline-exceeded':
        message = 'Tempo de resposta excedido. Tente novamente.'; break;
    }
    return { code, message };
  }
}
