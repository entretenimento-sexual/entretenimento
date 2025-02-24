// src\app\core\services\autentication\user-management.service.ts
import { Injectable } from '@angular/core';
import { FirestoreService } from '../data-handling/firestore.service';
import { FirestoreQueryService } from '../data-handling/firestore-query.service';
import { getAuth } from 'firebase/auth';
import { from, Observable, tap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UserManagementService {

  constructor(private firestoreService: FirestoreService,
    private firestoreQuery: FirestoreQueryService) { }

  // Reset de tentativas de login
  resetLoginAttempts(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { loginAttempts: 0 });
  }

  // Incremento de tentativas falhas
  incrementLoginAttempts(uid: string): Observable<void> {
    return this.firestoreService.incrementField('users', uid, 'loginAttempts', 1);
  }

  // Exclui permanentemente uma conta de usuário
  deleteUserAccount(uid: string): Observable<void> {
    return from(this.firestoreService.deleteDocument('users', uid)).pipe(
      // Remove o usuário do Firebase Authentication
      tap(() => {
        const auth = getAuth();
        const user = auth.currentUser;
        if (user && user.uid === uid) {
          user.delete();
        }
      })
    );
  }

  // Confirmação de Termos de Uso e Política de Privacidade
  confirmTermsOfService(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { termsAccepted: true });
  }

  // Buscar todos os usuários
  getAllUsers(): Observable<any[]> {
    return this.firestoreQuery.getAllUsers();
  }
}
