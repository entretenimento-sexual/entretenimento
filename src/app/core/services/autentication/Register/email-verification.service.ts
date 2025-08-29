// src/app/core/services/autentication/register/email-verification.service.ts
import { Injectable } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { getAuth, User, sendEmailVerification, applyActionCode } from 'firebase/auth';
import { doc, setDoc, updateDoc } from '@angular/fire/firestore';
import { Timestamp } from 'firebase/firestore';
import { from, of, throwError, Observable } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

import { FirestoreService } from '../../data-handling/firestore.service';
import { IUserDados } from '../../../interfaces/iuser-dados';
import { environment } from 'src/environments/environment';

export type VerifyEmailReason =
  | 'expired'        // link expirado
  | 'invalid'        // link inválido
  | 'not-logged-in'  // verificado, mas sem usuário logado (não deu pra atualizar Firestore)
  | 'not-verified'   // applyActionCode ok, mas currentUser não refletiu ainda
  | 'unknown';

export interface VerifyEmailResult {
  ok: boolean;
  firestoreUpdated?: boolean;
  reason?: VerifyEmailReason;
}

@Injectable({ providedIn: 'root' })
export class EmailVerificationService {
  constructor(
    private firestoreService: FirestoreService,
    private activatedRoute: ActivatedRoute
  ) { }

  /** Recarrega o usuário atual e retorna se o e-mail está verificado */
  reloadCurrentUser(): Observable<boolean> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return of(false);

    return from(currentUser.reload()).pipe(
      map(() => currentUser.emailVerified || false),
      catchError((error) => {
        console.log('[EmailVerificationService] Erro ao recarregar usuário:', error);
        return of(false);
      })
    );
  }

  /**
   * Envia o e-mail de verificação com handleCodeInApp para cair no handler.
   * Retorna erro com `code` confiável.
   */
  sendEmailVerification(user: User, redirectUrl: string = this.getRedirectUrl()): Observable<void> {
    return from(sendEmailVerification(user, { url: redirectUrl, handleCodeInApp: true })).pipe(
      tap(() => console.log('[EmailVerificationService] E-mail de verificação enviado.')),
      map(() => void 0),
      catchError((error) => {
        console.log('[EmailVerificationService] Falha no envio do e-mail:', error);
        const code = error?.code || 'email-verification-failed';
        const message =
          code === 'auth/unauthorized-domain' || code === 'auth/invalid-continue-uri'
            ? 'Domínio de redirecionamento não autorizado nas configurações do Firebase.'
            : 'Erro ao enviar e-mail de verificação.';
        return throwError(() => ({ code, message }));
      })
    );
  }

  /** 👉 ROTA DO HANDLER (usada dentro do link do e-mail) */
  private getRedirectUrl(): string {
    const isLocal = /^localhost$|^127\.0\.0\.1$/.test(location.hostname);
    const base = isLocal && location.origin
      ? location.origin
      : `https://${environment.firebase?.authDomain}`;
    return `${base}/post-verification/action?mode=verifyEmail`;
  }

  /** Aplica o código recebido no link do e-mail */
  verifyEmail(actionCode: string): Observable<void> {
    const auth = getAuth();
    return from(applyActionCode(auth, actionCode)).pipe(
      tap(() => console.log('[EmailVerificationService] E-mail verificado com sucesso.')),
      map(() => void 0),
      catchError((error) => {
        const message = this.mapErrorCodeToMessage(error?.code);
        return throwError(() => ({ code: error?.code, message }));
      })
    );
  }

  /**
   * Handler “rico”: não retorna só boolean, mas também a razão de falha/sucesso
   * e se o Firestore foi sincronizado.
   */
  handleEmailVerification(): Observable<VerifyEmailResult> {
    const actionCode = this.activatedRoute.snapshot.queryParamMap.get('oobCode');
    if (!actionCode) return throwError(() => new Error('Código de verificação ausente na URL.'));

    return this.verifyEmail(actionCode).pipe(
      switchMap(() => this.reloadCurrentUser()),
      switchMap((isVerified) => {
        const auth = getAuth();
        const uid = auth.currentUser?.uid ?? null;

        if (!isVerified) {
          return of<VerifyEmailResult>({ ok: false, reason: 'not-verified' });
        }

        if (!uid) {
          return of<VerifyEmailResult>({ ok: true, reason: 'not-logged-in' });
        }

        return this.updateEmailVerificationStatus(uid, true).pipe(
          map(() => ({ ok: true, firestoreUpdated: true } as VerifyEmailResult)),
          catchError(() => of({ ok: true, firestoreUpdated: false } as VerifyEmailResult))
        );
      }),
      catchError((err) => {
        const code = err?.code as string | undefined;
        const reason: VerifyEmailReason =
          code === 'auth/expired-action-code' ? 'expired' :
            code === 'auth/invalid-action-code' ? 'invalid' :
              'unknown';
        return of<VerifyEmailResult>({ ok: false, reason });
      })
    );
  }

  /** Atualiza o campo emailVerified no Firestore */
  updateEmailVerificationStatus(uid: string, status: boolean): Observable<void> {
    const userRef = doc(this.firestoreService.getFirestoreInstance(), 'users', uid);
    return from(updateDoc(userRef, { emailVerified: status })).pipe(
      tap(() => console.log(`[EmailVerificationService] Status atualizado: ${status}`)),
      map(() => void 0),
      catchError((error) => {
        console.log('[EmailVerificationService] Falha ao atualizar status no Firestore:', error);
        return throwError(() => new Error('Erro ao atualizar verificação no Firestore.'));
      })
    );
  }

  /** Salva/mescla dados após verificação (se necessário) */
  saveUserDataAfterEmailVerification(user: IUserDados): Observable<void> {
    if (!user.uid) return throwError(() => new Error('UID do usuário não definido.'));
    const data = { ...user, role: user.role || 'basico', createdAt: Timestamp.fromDate(new Date()) };
    const userRef = doc(this.firestoreService.getFirestoreInstance(), 'users', user.uid);

    return from(setDoc(userRef, data, { merge: true })).pipe(
      tap(() => console.log('[EmailVerificationService] Dados salvos após verificação.')),
      map(() => void 0),
      catchError((error) => {
        console.log('[EmailVerificationService] Falha ao salvar dados:', error);
        return throwError(() => new Error('Erro ao salvar dados do usuário.'));
      })
    );
  }

  /** UID do usuário autenticado (sem depender do AuthService) */
  getCurrentUserUid(): Observable<string | null> {
    const uid = getAuth().currentUser?.uid ?? null;
    return of(uid);
  }

  /** Reenvia o e-mail de verificação usando a mesma rota do handler */
  resendVerificationEmail(redirectUrl: string = this.getRedirectUrl()): Observable<string> {
    const user = getAuth().currentUser;
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
}
