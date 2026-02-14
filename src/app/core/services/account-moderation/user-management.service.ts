// src/app/core/services/autentication/user-management.service.ts
// Serviço para gerenciamento de usuários (admin)
// Não esquecer os comentários e ferramentas de debug para facilitar a manutenção futura
import { Injectable } from '@angular/core';
import { FirestoreService } from '../data-handling/legacy/firestore.service';
import { FirestoreQueryService } from '../data-handling/firestore-query.service';
import { Auth } from '@angular/fire/auth';             // ✅ injete o Auth
import { deleteUser } from 'firebase/auth';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { Observable, of, throwError, from } from 'rxjs';
import { concatMap, catchError, map } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';

@Injectable({ providedIn: 'root' })
export class UserManagementService {
  constructor(
    private readonly write: FirestoreWriteService,
    private firestoreService: FirestoreService,
    private firestoreQuery: FirestoreQueryService,
    private auth: Auth,
    private firestoreUserQuery: FirestoreUserQueryService
  ) { }

  getUserById(uid: string) {
    return this.firestoreUserQuery.getUserById(uid);
  }

  resetLoginAttempts(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { loginAttempts: 0 });
  }

  incrementLoginAttempts(uid: string): Observable<void> {
    return this.firestoreService.incrementField('users', uid, 'loginAttempts', 1);
  }

  /**
   * Exclui a conta do usuário logado:
   * - Apaga o doc no Firestore
   * - Em seguida apaga o Auth user (se for o próprio)
   *
   * Observações:
   * - Se não for o usuário atual, apenas remove o doc (para apagar o Auth de outro usuário,
   *   use uma Cloud Function com Admin SDK).
   * - Pode falhar com `auth/requires-recent-login`.
   */
  deleteUserAccount(uid: string): Observable<void> {
    return this.firestoreService.deleteDocument('users', uid).pipe(
      concatMap(() => {
        const user = this.auth.currentUser;
        if (user && user.uid === uid) {
          // encadeia e propaga erro corretamente
          return from(deleteUser(user)).pipe(
            map(() => void 0),
            catchError(err => {
              if (err?.code === 'auth/requires-recent-login') {
                return throwError(() => new Error('REAUTH_REQUIRED'));
              }
              return throwError(() => err);
            })
          );
        }
        // não é o usuário logado -> somente Firestore (Auth via função admin)
        return of(void 0);
      })
    );
  }

  /** Mantém consistência com o nome usado no registro (acceptedTerms). */
  confirmTermsOfService(uid: string): Observable<void> {
    return this.write.updateDocument('users', uid, {
      acceptedTerms: { accepted: true, date: Date.now() }
    }, { context: 'UserManagementService.confirmTermsOfService' });
  }

  getAllUsers(): Observable<IUserDados[]> {
    return this.firestoreQuery.getAllUsers();
  }
}
