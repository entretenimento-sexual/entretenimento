// src/app/core/services/account-moderation/user-management.service.ts
// Serviço para gerenciamento administrativo de usuários.
import { Injectable } from '@angular/core';

import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';

import { IUserDados } from '../../interfaces/iuser-dados';

import { FirestoreQueryService } from '../data-handling/firestore-query.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';
import { AccountLifecycleService } from 'src/app/account/application/account-lifecycle.service';

@Injectable({ providedIn: 'root' })
export class UserManagementService {
  constructor(
    private readonly write: FirestoreWriteService,
    private readonly firestoreQuery: FirestoreQueryService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly accountLifecycle: AccountLifecycleService
  ) {}

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
  // WRITES ADMINISTRATIVAS
  // -----------------------------------------------------------------------------

  resetLoginAttempts(uid: string): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(
        () => new Error('[UserManagementService] uid inválido em resetLoginAttempts')
      );
    }

    return this.write.updateDocument(
      'users',
      safeUid,
      { loginAttempts: 0 },
      { context: 'UserManagementService.resetLoginAttempts' }
    );
  }

  incrementLoginAttempts(uid: string): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(
        () => new Error('[UserManagementService] uid inválido em incrementLoginAttempts')
      );
    }

    return this.write.incrementField(
      'users',
      safeUid,
      'loginAttempts',
      1,
      { context: 'UserManagementService.incrementLoginAttempts' }
    );
  }

  /**
   * Agenda a exclusão administrativa pelo domínio canônico de lifecycle.
   *
   * O nome do método foi preservado temporariamente para não quebrar os
   * consumidores do painel administrativo. Ele NÃO apaga mais `users/{uid}`
   * diretamente e NÃO chama `deleteUser()` no navegador.
   *
   * Motivo da substituição:
   * - a implementação anterior removia o documento antes do Auth;
   * - uma falha `auth/requires-recent-login` podia deixar uma conta autenticável
   *   sem documento privado;
   * - exclusão de outro usuário exige Admin SDK e autorização de staff;
   * - retenção, auditoria e expurgo pertencem ao backend.
   */
  deleteUserAccount(
    uid: string,
    reason = 'Exclusão agendada pelo painel administrativo.'
  ): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    const safeReason = String(reason ?? '').trim();

    if (!safeUid) {
      return throwError(
        () => new Error('[UserManagementService] uid inválido em deleteUserAccount')
      );
    }

    if (!safeReason) {
      return throwError(
        () => new Error('[UserManagementService] motivo inválido em deleteUserAccount')
      );
    }

    return this.accountLifecycle
      .moderateScheduleDeletion$(safeUid, safeReason)
      .pipe(map(() => void 0));
  }

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }
}
