// src/app/core/services/autentication/register/email-verification.service.ts
import { Injectable } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Auth } from '@angular/fire/auth';
import { User, sendEmailVerification, applyActionCode, checkActionCode } from 'firebase/auth';

import {
  doc, setDoc, updateDoc, Timestamp,
  collection, getDocs, query, where
} from '@angular/fire/firestore';

import { from, of, throwError, Observable } from 'rxjs';
import { catchError, map, switchMap, tap, timeout } from 'rxjs/operators';

import { FirestoreService } from '../../data-handling/firestore.service';
import { IUserDados } from '../../../interfaces/iuser-dados';
import { environment } from 'src/environments/environment';

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
    private firestoreService: FirestoreService,
    private activatedRoute: ActivatedRoute,
    // ✅ injeta o Auth provido por provideAuth()
    private auth: Auth,
  ) { }

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

  /** Envia o e-mail de verificação para a rota handler da app */
  sendEmailVerification(user: User, redirectUrl: string = this.getRedirectUrl()): Observable<void> {
    return from(sendEmailVerification(user, { url: redirectUrl, handleCodeInApp: true })).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      tap(() => console.log('[EmailVerificationService] E-mail de verificação enviado.')),
      map(() => void 0),
      catchError((error) => {
        console.log('[EmailVerificationService] Falha no envio do e-mail:', error);
        const code = error?.code || 'email-verification-failed';
        const message =
          code === 'auth/unauthorized-domain' || code === 'auth/invalid-continue-uri'
            ? 'Domínio de redirecionamento não autorizado nas configurações do Firebase.'
            : code === 'deadline-exceeded'
              ? 'Tempo de resposta excedido ao enviar e-mail. Tente novamente.'
              : 'Erro ao enviar e-mail de verificação.';
        return throwError(() => ({ code, message }));
      })
    );
  }

  /** URL que o link do e-mail deve abrir (seu handler) */
  private getRedirectUrl(): string {
    const isLocal = /^localhost$|^127\.0\.0\.1$/.test(location.hostname);
    const base = isLocal && location.origin
      ? location.origin
      : `https://${environment.firebase?.authDomain}`;
    return `${base}/post-verification/action?mode=verifyEmail`;
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

  /** Fallback: marca emailVerified pelo e-mail (sem depender de sessão) */
  private updateEmailVerifiedByEmail(email: string): Observable<void> {
    const fs = this.firestoreService.getFirestoreInstance();
    const qref = query(collection(fs, 'users'), where('email', '==', email));
    return from(getDocs(qref)).pipe(
      switchMap((snap) => {
        if (snap.empty) return throwError(() => new Error('Usuário não encontrado pelo e-mail.'));
        const writes = snap.docs.map(d => updateDoc(d.ref, { emailVerified: true }));
        return from(Promise.all(writes));
      }),
      map(() => void 0)
    );
  }

  /** Fluxo completo do handler (rota aberta pelo link do e-mail) */
  handleEmailVerification(): Observable<VerifyEmailResult> {
    const actionCode = this.activatedRoute.snapshot.queryParamMap.get('oobCode');
    if (!actionCode) return throwError(() => new Error('Código de verificação ausente na URL.'));

    return from(checkActionCode(this.auth, actionCode)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      switchMap(info => this.verifyEmail(actionCode).pipe(map(() => info))),
      switchMap((info) => {
        const emailFromCode = (info?.data as any)?.email as string | undefined;
        const u = this.auth.currentUser;

        if (!u) {
          if (!emailFromCode) return of<VerifyEmailResult>({ ok: true, reason: 'not-logged-in' });
          return this.updateEmailVerifiedByEmail(emailFromCode).pipe(
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
    const userRef = doc(this.firestoreService.getFirestoreInstance(), 'users', uid);
    return from(updateDoc(userRef, { emailVerified: status })).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
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
      timeout({ each: this.NET_TIMEOUT_MS }),
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
    const uid = this.auth.currentUser?.uid ?? null;
    return of(uid);
  }

  /** Reenvia o e-mail de verificação */
  resendVerificationEmail(redirectUrl: string = this.getRedirectUrl()): Observable<string> {
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
}
