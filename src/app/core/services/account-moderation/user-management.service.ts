// src/app/core/services/autentication/user-management.service.ts
// Serviço para gerenciamento de usuários (admin)
// Não esquecer os comentários e ferramentas de debug para facilitar a manutenção futura

import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { deleteUser } from 'firebase/auth';

import { Observable, of, throwError, from } from 'rxjs';
import { catchError, concatMap, map } from 'rxjs/operators';

import { IUserDados } from '../../interfaces/iuser-dados';

import { FirestoreQueryService } from '../data-handling/firestore-query.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';

@Injectable({ providedIn: 'root' })
export class UserManagementService {
  constructor(
    private readonly write: FirestoreWriteService,
    private readonly firestoreQuery: FirestoreQueryService,
    private readonly auth: Auth,
    private readonly firestoreUserQuery: FirestoreUserQueryService
  ) { }

  // -----------------------------------------------------------------------------
  // READS
  // -----------------------------------------------------------------------------

  getUserById(uid: string) {
    return this.firestoreUserQuery.getUserById(uid);
  }

  getAllUsers(): Observable<IUserDados[]> {
    return this.firestoreQuery.getAllUsers();
  }

  // -----------------------------------------------------------------------------
  // WRITES (removido legacy FirestoreService)
  // -----------------------------------------------------------------------------

  resetLoginAttempts(uid: string): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) return throwError(() => new Error('[UserManagementService] uid inválido em resetLoginAttempts'));

    return this.write.updateDocument(
      'users',
      safeUid,
      { loginAttempts: 0 },
      { context: 'UserManagementService.resetLoginAttempts' }
    );
  }

  incrementLoginAttempts(uid: string): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) return throwError(() => new Error('[UserManagementService] uid inválido em incrementLoginAttempts'));

    return this.write.incrementField(
      'users',
      safeUid,
      'loginAttempts',
      1,
      { context: 'UserManagementService.incrementLoginAttempts' }
    );
  }

  /**
   * Exclui a conta do usuário:
   * - Apaga o doc em /users/{uid}
   * - Se for o próprio usuário logado, tenta remover também do Auth.
   *
   * Observações:
   * - Para apagar o Auth de OUTRO usuário: precisa Cloud Function (Admin SDK).
   * - Pode falhar com `auth/requires-recent-login`.
   */
  deleteUserAccount(uid: string): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) return throwError(() => new Error('[UserManagementService] uid inválido em deleteUserAccount'));

    return this.write.deleteDocument('users', safeUid, {
      context: 'UserManagementService.deleteUserAccount:deleteFirestoreDoc',
    }).pipe(
      concatMap(() => {
        const user = this.auth.currentUser;

        // Se não é o usuário logado -> apenas Firestore (Auth via Admin SDK)
        if (!user || user.uid !== safeUid) return of(void 0);

        return from(deleteUser(user)).pipe(
          map(() => void 0),
          catchError((err: any) => {
            if (err?.code === 'auth/requires-recent-login') {
              // Mantém seu “sinal” sem vazar detalhes; quem chama decide UX
              const e = new Error('REAUTH_REQUIRED');
              (e as any).code = 'auth/requires-recent-login';
              return throwError(() => e);
            }
            return throwError(() => err);
          })
        );
      })
    );
  }

  /** Mantém consistência com o nome usado no registro (acceptedTerms). */
  confirmTermsOfService(uid: string): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) return throwError(() => new Error('[UserManagementService] uid inválido em confirmTermsOfService'));

    return this.write.updateDocument(
      'users',
      safeUid,
      { acceptedTerms: { accepted: true, date: Date.now() } },
      { context: 'UserManagementService.confirmTermsOfService' }
    );
  }

  // -----------------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------------

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }
}
