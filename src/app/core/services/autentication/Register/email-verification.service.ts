//src\app\core\services\autentication\register\email-verification.service.ts
import { Injectable } from '@angular/core';
import { doc, setDoc, updateDoc, Timestamp } from '@firebase/firestore';
import { getAuth, User, sendEmailVerification, applyActionCode } from 'firebase/auth';
import { FirestoreService } from '../../data-handling/firestore.service';
import { ActivatedRoute } from '@angular/router';
import { Observable, from, throwError, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { IUserDados } from '../../../interfaces/iuser-dados';
import { FirestoreUserQueryService } from '../../data-handling/firestore-user-query.service';
import { CacheService } from '../../general/cache/cache.service';
import { AuthService } from '../auth.service';

@Injectable({
  providedIn: 'root'
})
export class EmailVerificationService {
  constructor(
    private firestoreService: FirestoreService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private cacheService: CacheService,
    private authService: AuthService,
    private activatedRoute: ActivatedRoute // Adicionado para capturar o oobCode diretamente da URL
  ) { }

  //Recarrega o estado do usuário no Firebase Authentication e verifica se o e-mail está verificado.
  reloadCurrentUser(): Observable<boolean> {
    const auth = getAuth();
    if (auth.currentUser) {
      return from(auth.currentUser.reload()).pipe(
        map(() => auth.currentUser?.emailVerified || false),
        catchError((error) => {
          console.error('Erro ao recarregar o estado do usuário:', error);
          return of(false);
        })
      );
    }
    return of(false);
  }

  /**
   * Atualiza o status de verificação de e-mail no Firestore.
   * @param uid - ID do usuário no Firestore.
   * @param status - Status de verificação de e-mail (true/false).
   */
  updateEmailVerificationStatus(uid: string, status: boolean): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();
    const userRef = doc(db, 'users', uid);
    return from(updateDoc(userRef, { emailVerified: status })).pipe(
      map(() => console.log(`Status de verificação atualizado para: ${status}`)),
      catchError((error) => {
        console.error('Erro ao atualizar status de verificação no Firestore:', error);
        return throwError(() => new Error('Erro ao atualizar status de verificação.'));
      })
    );
  }

  /**
   * Envia um e-mail de verificação para o usuário.
   * @param user - Usuário do Firebase.
   * @param redirectUrl - URL de redirecionamento após a verificação.
   */
  sendEmailVerification(user: User, redirectUrl: string = 'http://localhost:4200/email-verified'): Observable<void> {
    const actionCodeSettings = { url: redirectUrl };
    return from(sendEmailVerification(user, actionCodeSettings)).pipe(
      map(() => console.log('E-mail de verificação enviado com sucesso.')),
      catchError((error) => {
        console.error('Erro ao enviar e-mail de verificação:', error);
        return throwError(() => new Error('Erro ao enviar e-mail de verificação.'));
      })
    );
  }

  /**
   * Verifica o e-mail utilizando o código de ação (oobCode).
   * @param actionCode - Código de ação para verificação.
   */
  verifyEmail(actionCode: string): Observable<void> {
    const auth = getAuth();
    return from(applyActionCode(auth, actionCode)).pipe(
      map(() => console.log('E-mail verificado com sucesso.')),
      catchError((error) => {
        console.error('Erro ao verificar o e-mail:', error);
        return throwError(() => {
          if (error.code === 'auth/expired-action-code') {
            return new Error('O link de verificação expirou. Solicite um novo link.');
          } else if (error.code === 'auth/invalid-action-code') {
            return new Error('O link de verificação é inválido. Solicite um novo e-mail de verificação.');
          }
          return new Error('Erro inesperado ao verificar o e-mail.');
        });
      })
    );
  }

  /**
   * Reenvia o e-mail de verificação para o usuário atual.
   * @param redirectUrl - URL de redirecionamento após a verificação.
   */
  resendVerificationEmail(redirectUrl: string = 'http://localhost:4200/email-verified'): Observable<string> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (currentUser) {
      return this.sendEmailVerification(currentUser, redirectUrl).pipe(
        map(() => `E-mail de verificação reenviado para ${currentUser.email}. Verifique sua caixa de entrada.`),
        catchError((error) => {
          console.error('Erro ao reenviar o e-mail de verificação:', error);
          return throwError(() => new Error('Erro ao reenviar o e-mail de verificação.'));
        })
      );
    }
    return throwError(() => new Error('Nenhum usuário autenticado encontrado.'));
  }

  /**
   * Manipula a verificação de e-mail aplicando o código de ação da URL.
   */
  handleEmailVerification(): Observable<boolean> {
    const actionCode = this.activatedRoute.snapshot.queryParamMap.get('oobCode');

    if (!actionCode) {
      console.error('Nenhum oobCode encontrado na URL.');
      return throwError(() => new Error('Código de verificação ausente na URL.'));
    }

    return this.verifyEmail(actionCode).pipe(
      switchMap(() => this.reloadCurrentUser()),
      switchMap((isEmailVerified) => {
        if (isEmailVerified) {
          const currentUserUid = getAuth().currentUser?.uid;
          if (currentUserUid) {
            return this.updateEmailVerificationStatus(currentUserUid, true).pipe(
              map(() => isEmailVerified)
            );
          }
        }
        return of(isEmailVerified);
      }),
      catchError((error) => {
        console.error('Erro ao manipular a verificação de e-mail:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Salva os dados do usuário no Firestore após a verificação de e-mail.
   * @param user - Dados do usuário.
   */
  saveUserDataAfterEmailVerification(user: IUserDados): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();

    if (!user.uid) {
      return throwError(() => new Error('UID do usuário não definido.'));
    }

    const userData = {
      ...user,
      role: user.role || 'basico',
      createdAt: Timestamp.fromDate(new Date())
    };

    const userRef = doc(db, 'users', user.uid);

    return from(setDoc(userRef, userData, { merge: true })).pipe(
      map(() => console.log('Dados do usuário salvos após verificação de e-mail.')),
      catchError((error) => {
        console.error('Erro ao salvar os dados do usuário:', error);
        return throwError(() => new Error('Erro ao salvar os dados do usuário.'));
      })
    );
  }

  /**
 * Obtém o UID do usuário atual.
 */
  getCurrentUserUid(): Observable<string | null> {
    return this.authService.getLoggedUserUID$().pipe(
      catchError((error) => {
        console.error('Erro ao obter UID do usuário no EmailVerificationService:', error);
        return of(null);
      })
    );
  }

}
