// src/app/core/services/autentication/register/email-verification.service.ts
// EmailVerificationService: gerencia o fluxo de verificação de e-mail
// Não esquecer os comentários
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { Auth } from '@angular/fire/auth';
import {
  User,
  sendEmailVerification,
  applyActionCode,
  checkActionCode,
  ActionCodeSettings
} from 'firebase/auth';

import {
  Firestore,
  doc, setDoc, updateDoc, Timestamp,
  collection, getDocs, query, where
} from '@angular/fire/firestore';

import { from, of, throwError, Observable } from 'rxjs';
import { catchError, map, switchMap, tap, timeout } from 'rxjs/operators';

import { IUserDados } from '../../../interfaces/iuser-dados';
import { environment } from 'src/environments/environment';
import { FirestoreUserWriteService } from '../../data-handling/firestore-user-write.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';

export type VerifyEmailReason =
  | 'expired'
  | 'invalid'
  | 'not-logged-in'
  | 'not-verified'
  | 'unknown';

export interface VerifyEmailResult {
  ok: boolean;
  firestoreUpdated?: boolean;
  reason?: VerifyEmailReason;
}

@Injectable({ providedIn: 'root' })
export class EmailVerificationService {
  private readonly NET_TIMEOUT_MS = 12000;

  constructor(
    private readonly router: Router,
    private readonly firestore: Firestore, // ✅ substitui FirestoreService legacy
    private readonly userWrite: FirestoreUserWriteService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService,
    private readonly auth: Auth,
  ) {
    // Ajuda o Firebase a enviar e-mails localizados
    try { this.auth.languageCode = 'pt-BR'; } catch { /* noop */ }
  }

  // -------------------------------------------------------
  // Helpers de ambiente / URLs
  // -------------------------------------------------------
  private isEmulator(): boolean {
    const cfg: any = environment as any;
    return !environment.production && !!cfg?.useEmulators && !!cfg?.emulators?.auth;
  }

  private isLocalHost(): boolean {
    // SSR-safe
    if (typeof location === 'undefined') return false;
    return /^(localhost|127\.0\.0\.1|::1)$/.test(location.hostname);
  }

  /** Base preferida para a continueUrl */
  private preferredBaseUrl(): string {
    const envAny: any = environment as any;

    // 1) Emulador → use a origem atual (http://localhost:4200)
    if (this.isEmulator() && typeof location !== 'undefined' && location.origin) {
      return location.origin;
    }

    // 2) Se houver base configurada, priorize (aceita os dois nomes)
    const configured =
      envAny?.authActionHandlerBaseUrl || // ← se você preferir esse nome
      envAny?.appBaseUrl;                 // ← ou esse
    if (configured) return String(configured);

    // 3) Dev sem emulador → tente a origem local
    if (this.isLocalHost() && typeof location !== 'undefined' && location.origin) {
      return location.origin;
    }

    // 4) Prod: origem atual, senão o authDomain
    if (typeof location !== 'undefined' && location.origin) return location.origin;

    // 5) Fallback final
    return `https://${environment.firebase?.authDomain}`;
  }

  private safeBaseUrl(): string {
    // No emulador, manter a origem local como fallback “sempre autorizado”
    if (this.isEmulator() && typeof location !== 'undefined' && location.origin) {
      return location.origin;
    }
    // Em prod, usar o authDomain (domínio já autorizado no Firebase Console)
    return `https://${environment.firebase?.authDomain}`;
  }

  private buildContinueUrl(base: string): string {
    // Mantemos um handler único na app
    return `${base}/post-verification/action`;
  }

  private buildActionCodeSettings(base?: string): ActionCodeSettings {
    const continueBase = base ?? this.preferredBaseUrl();
    const acs: ActionCodeSettings = {
      url: this.buildContinueUrl(continueBase),
      handleCodeInApp: true, // garante redirecionamento para a nossa rota
    };

    // Suporte opcional a dynamic links se houver (não obrigatório)
    const envAny: any = environment as any;
    if (envAny?.dynamicLinkDomain) {
      acs.dynamicLinkDomain = envAny.dynamicLinkDomain;
    }
    return acs;
  }

  // -------------------------------------------------------
  // API pública
  // -------------------------------------------------------

  /** Recarrega o usuário atual e retorna se o e-mail está verificado */
  reloadCurrentUser(): Observable<boolean> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) return of(false);

    return from(currentUser.reload()).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      map(() => currentUser.emailVerified || false),
      catchError((error) => {
        console.log('[EmailVerificationService] Erro ao recarregar usuário:', error);
        return of(false);
      })
    );
  }

  /** Envia o e-mail de verificação com ACS dinâmico + fallback automático */
  sendEmailVerification(user: User, redirectUrl?: string): Observable<void> {
    // Se o caller passar uma URL, respeitamos; senão montamos automaticamente
    const primaryAcs = redirectUrl
      ? ({ url: redirectUrl, handleCodeInApp: true } as ActionCodeSettings)
      : this.buildActionCodeSettings();

    const safeAcs = this.buildActionCodeSettings(this.safeBaseUrl()); // sempre autorizado

    return from(sendEmailVerification(user, primaryAcs)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      tap(() => console.log('[EmailVerificationService] E-mail de verificação enviado (ACS primário).')),
      map(() => void 0),
      catchError((error) => {
        const code = error?.code || 'email-verification-failed';

        // Se for bloqueio de domínio/URL, tentamos um fallback garantido (authDomain)
        if (code === 'auth/unauthorized-domain' || code === 'auth/invalid-continue-uri') {
          console.log('[EmailVerificationService] Dominio/URL não autorizado. Tentando fallback no authDomain…');
          return from(sendEmailVerification(user, safeAcs)).pipe(
            timeout({ each: this.NET_TIMEOUT_MS }),
            tap(() => console.log('[EmailVerificationService] E-mail de verificação enviado (fallback authDomain).')),
            map(() => void 0),
            catchError((err2) => {
              const code2 = err2?.code || 'email-verification-failed';
              const message2 =
                code2 === 'deadline-exceeded'
                  ? 'Tempo de resposta excedido ao enviar e-mail. Tente novamente.'
                  : 'Erro ao enviar e-mail de verificação (fallback também falhou).';
              return throwError(() => ({ code: code2, message: message2 }));
            })
          );
        }

        const message =
          code === 'deadline-exceeded'
            ? 'Tempo de resposta excedido ao enviar e-mail. Tente novamente.'
            : 'Erro ao enviar e-mail de verificação.';
        return throwError(() => ({ code, message }));
      })
    );
  }

  /** Aplica o código recebido no link do e-mail */
  verifyEmail(actionCode: string): Observable<void> {
    return from(applyActionCode(this.auth, actionCode)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      tap(() => console.log('[EmailVerificationService] E-mail verificado com sucesso.')),
      map(() => void 0),
      catchError((error) => {
        const message = this.mapErrorCodeToMessage(error?.code);
        return throwError(() => ({ code: error?.code, message }));
      })
    );
  }

  /** Fluxo completo do handler (rota aberta pelo link do e-mail) */
  handleEmailVerification(): Observable<VerifyEmailResult> {
    // ✅ Em service singleton, ActivatedRoute pode ser inconsistente.
    // Preferimos Router.parseUrl(router.url) para ler query params atuais.
    const tree = this.router.parseUrl(this.router.url || '');
    const qp = tree?.queryParams ?? {};

    const mode = (qp['mode'] as string | undefined) ?? null;
    const actionCode = (qp['oobCode'] as string | undefined) ?? null;

    if (mode && mode !== 'verifyEmail') {
      // Evita processar outros modos por engano
      return of({ ok: false, reason: 'unknown' } as VerifyEmailResult);
    }
    if (!actionCode) return throwError(() => new Error('Código de verificação ausente na URL.'));

    return from(checkActionCode(this.auth, actionCode)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      switchMap(info => this.verifyEmail(actionCode).pipe(map(() => info))),
      switchMap((info) => {
        const emailFromCode = (info?.data as any)?.email as string | undefined;
        const u = this.auth.currentUser;

        if (!u) {
          if (!emailFromCode) return of<VerifyEmailResult>({ ok: true, reason: 'not-logged-in' });
          return this.userWrite.patchEmailVerifiedByEmail$(emailFromCode, true).pipe(
            map(() => ({ ok: true, firestoreUpdated: true } as VerifyEmailResult)),
            catchError(() => of({ ok: true, firestoreUpdated: false, reason: 'not-logged-in' } as VerifyEmailResult))
          );
        }

        // Sessão presente → recarrega e atualiza por UID
        return from(u.reload()).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          switchMap(() => {
            const refreshed = this.auth.currentUser;
            if (!refreshed?.emailVerified) {
              return of<VerifyEmailResult>({ ok: false, reason: 'not-verified' });
            }
            return this.updateEmailVerificationStatus(refreshed.uid, true).pipe(
              map(() => ({ ok: true, firestoreUpdated: true } as VerifyEmailResult)),
              catchError(() => of({ ok: true, firestoreUpdated: false } as VerifyEmailResult))
            );
          })
        );
      }),
      catchError((err) => {
        const code = err?.code as string | undefined;
        const reason: VerifyEmailReason =
          code === 'auth/expired-action-code' ? 'expired' :
            code === 'auth/invalid-action-code' ? 'invalid' : 'unknown';
        return of<VerifyEmailResult>({ ok: false, reason });
      })
    );
  }

  /** Atualiza o campo emailVerified no Firestore */
  updateEmailVerificationStatus(uid: string, status: boolean): Observable<void> {
    return this.userWrite.patchEmailVerified$(uid, status).pipe(
      catchError((err) => {
        // Ação explícita do usuário → pode ter feedback claro
        this.notify.showError('Não foi possível atualizar a verificação agora. Tente novamente.');

        // Log centralizado, sem duplicar toast (ver patch do GlobalErrorHandler abaixo)
        const e = new Error('Falha ao atualizar emailVerified no Firestore.');
        (e as any).skipUserNotification = true; // ✅ evita toast duplicado no GlobalErrorHandler
        (e as any).original = err;
        (e as any).context = 'email-verification.patchEmailVerified';
        try { this.globalError.handleError(e); } catch { /* noop */ }

        return throwError(() => err);
      })
    );
  }

  /** Salva/mescla dados após verificação (se necessário) */
  saveUserDataAfterEmailVerification(user: IUserDados): Observable<void> {
    return this.userWrite.saveUserDataAfterEmailVerification$(user);
  }

  /** UID do usuário autenticado */
  getCurrentUserUid(): Observable<string | null> {
    const uid = this.auth.currentUser?.uid ?? null;
    return of(uid);
  }

  /** Reenvia o e-mail de verificação */
  resendVerificationEmail(redirectUrl?: string): Observable<string> {
    const user = this.auth.currentUser;
    if (!user) return throwError(() => new Error('Nenhum usuário autenticado encontrado.'));

    return this.sendEmailVerification(user, redirectUrl).pipe(
      map(() => `E-mail reenviado para ${user.email}. Verifique sua caixa de entrada.`),
      catchError((error) => {
        console.log('[EmailVerificationService] Falha ao reenviar e-mail:', error);
        return throwError(() => new Error('Erro ao reenviar e-mail de verificação.'));
      })
    );
  }

  private mapErrorCodeToMessage(code?: string): string {
    switch (code) {
      case 'auth/expired-action-code': return 'O link expirou. Solicite um novo.';
      case 'auth/invalid-action-code': return 'O link é inválido. Solicite um novo.';
      default: return 'Erro ao verificar o e-mail.';
    }
  }
} // Linha 344
/* Linha final:
   - Redução: removemos ActivatedRoute e FirestoreService legacy.
   - Recomendo realocar “writes por e-mail” e “setDoc pós-verificação”
     para FirestoreUserWriteService (veja nota abaixo).
*/
