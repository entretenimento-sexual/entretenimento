// src/app/core/services/autentication/register/email-verification.service.ts
import { Injectable } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { getAuth, User, sendEmailVerification, applyActionCode } from 'firebase/auth';
import { doc, setDoc, updateDoc, Timestamp } from '@firebase/firestore';
import { from, of, throwError, Observable } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { FirestoreService } from '../../data-handling/firestore.service';
import { FirestoreUserQueryService } from '../../data-handling/firestore-user-query.service';
import { AuthService } from '../auth.service';
import { IUserDados } from '../../../interfaces/iuser-dados';

@Injectable({ providedIn: 'root' })
export class EmailVerificationService {
  constructor(
    private firestoreService: FirestoreService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private authService: AuthService,
    private activatedRoute: ActivatedRoute
  ) { }

  reloadCurrentUser(): Observable<boolean> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) return of(false);

    return from(currentUser.reload()).pipe(
      map(() => currentUser.emailVerified || false),
      catchError((error) => {
        console.error('[EmailVerificationService] Erro ao recarregar usuário:', error);
        return of(false);
      })
    );
  }

  sendEmailVerification(user: User, redirectUrl: string = this.getRedirectUrl()): Observable<void> {
    return from(sendEmailVerification(user, { url: redirectUrl })).pipe(
      map(() => console.log('[EmailVerificationService] E-mail de verificação enviado.')),
      catchError((error) => {
        console.error('[EmailVerificationService] Falha ao enviar e-mail:', error);
        return throwError(() => new Error('Erro ao enviar e-mail de verificação.'));
      })
    );
  }

  verifyEmail(actionCode: string): Observable<void> {
    const auth = getAuth();
    return from(applyActionCode(auth, actionCode)).pipe(
      map(() => console.log('[EmailVerificationService] E-mail verificado com sucesso.')),
      catchError((error) => {
        const message = this.mapErrorCodeToMessage(error.code);
        return throwError(() => new Error(message));
      })
    );
  }

  handleEmailVerification(): Observable<boolean> {
    const actionCode = this.activatedRoute.snapshot.queryParamMap.get('oobCode');
    if (!actionCode) {
      return throwError(() => new Error('Código de verificação ausente na URL.'));
    }

    return this.verifyEmail(actionCode).pipe(
      switchMap(() => this.reloadCurrentUser()),
      switchMap((isVerified) => {
        if (isVerified) {
          const uid = getAuth().currentUser?.uid;
          return uid ? this.updateEmailVerificationStatus(uid, true).pipe(map(() => true)) : of(true);
        }
        return of(false);
      }),
      catchError((error) => {
        console.error('[EmailVerificationService] Erro ao verificar e atualizar status:', error);
        return throwError(() => error);
      })
    );
  }

  updateEmailVerificationStatus(uid: string, status: boolean): Observable<void> {
    const userRef = doc(this.firestoreService.getFirestoreInstance(), 'users', uid);
    return from(updateDoc(userRef, { emailVerified: status })).pipe(
      map(() => console.log(`[EmailVerificationService] Status atualizado: ${status}`)),
      catchError((error) => {
        console.error('[EmailVerificationService] Falha ao atualizar status no Firestore:', error);
        return throwError(() => new Error('Erro ao atualizar verificação no Firestore.'));
      })
    );
  }

  saveUserDataAfterEmailVerification(user: IUserDados): Observable<void> {
    if (!user.uid) return throwError(() => new Error('UID do usuário não definido.'));

    const data = {
      ...user,
      role: user.role || 'basico',
      createdAt: Timestamp.fromDate(new Date())
    };
    const userRef = doc(this.firestoreService.getFirestoreInstance(), 'users', user.uid);

    return from(setDoc(userRef, data, { merge: true })).pipe(
      map(() => console.log('[EmailVerificationService] Dados salvos após verificação.')),
      catchError((error) => {
        console.error('[EmailVerificationService] Falha ao salvar dados:', error);
        return throwError(() => new Error('Erro ao salvar dados do usuário.'));
      })
    );
  }

  getCurrentUserUid(): Observable<string | null> {
    return this.authService.getLoggedUserUID$().pipe(
      catchError((error) => {
        console.error('[EmailVerificationService] Erro ao obter UID:', error);
        return of(null);
      })
    );
  }

  resendVerificationEmail(redirectUrl: string = this.getRedirectUrl()): Observable<string> {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) return throwError(() => new Error('Nenhum usuário autenticado encontrado.'));

    return this.sendEmailVerification(user, redirectUrl).pipe(
      map(() => `E-mail reenviado para ${user.email}. Verifique sua caixa de entrada.`),
      catchError((error) => {
        console.error('[EmailVerificationService] Falha ao reenviar e-mail:', error);
        return throwError(() => new Error('Erro ao reenviar e-mail de verificação.'));
      })
    );
  }

  private getRedirectUrl(): string {
    return `${window.location.origin}/email-verified`; // ou usar `environment.baseUrl`
  }

  private mapErrorCodeToMessage(code: string): string {
    switch (code) {
      case 'auth/expired-action-code':
        return 'O link expirou. Solicite um novo.';
      case 'auth/invalid-action-code':
        return 'O link é inválido. Solicite um novo.';
      default:
        return 'Erro ao verificar o e-mail.';
    }
  }
}
