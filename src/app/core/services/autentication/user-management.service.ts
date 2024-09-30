// src\app\core\services\autentication\user-management.service.ts
import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { Timestamp } from 'firebase/firestore';
import { from, Observable, of, tap } from 'rxjs';
import { getAuth } from 'firebase/auth';

@Injectable({
  providedIn: 'root'
})
export class UserManagementService {

  constructor(private firestoreService: FirestoreService) { }

  // 1. Reseta o status de tentativas de login em caso de erro
  resetLoginAttempts(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { loginAttempts: 0 });
  }

  // 2. Incrementa tentativas de login falhas
  incrementLoginAttempts(uid: string): Observable<void> {
    return this.firestoreService.incrementField('users', uid, 'loginAttempts', 1);
  }

  // 3. Bloqueia a conta temporariamente após muitas tentativas falhas
  lockAccount(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { accountLocked: true });
  }

  // 4. Desbloqueia uma conta manualmente após revisão
  unlockAccount(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { accountLocked: false });
  }

  // 5. Suspende um usuário (ex: por comportamento inadequado)
  suspendUser(uid: string, reason: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, {
      suspended: true,
      suspensionReason: reason,
      suspendedAt: Timestamp.fromDate(new Date())
    });
  }

  // 6. Remove a suspensão de um usuário
  unsuspendUser(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, {
      suspended: false,
      suspensionReason: null,
      suspendedAt: null
    });
  }

  // 7. Exclui uma conta de usuário permanentemente
  deleteUserAccount(uid: string): Observable<void> {
    // Remove os dados do Firestore
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

  // 8. Confirmação de Termos de Uso e Política de Privacidade
  confirmTermsOfService(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { termsAccepted: true });
  }

  // 9. Notifica sobre tentativas suspeitas de registro
  notifySuspiciousRegistrationAttempt(email: string, ip: string): void {
    console.warn(`Tentativa de registro suspeita detectada para o e-mail: ${email}, IP: ${ip}`);
    // Enviar notificação ao administrador, se necessário
  }

}
