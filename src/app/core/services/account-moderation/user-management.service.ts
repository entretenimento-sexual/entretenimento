// src/app/core/services/account-moderation/user-management.service.ts
// Serviço para leituras e escritas administrativas simples de usuários.
// Operações de lifecycle pertencem ao AccountLifecycleService.
import { Injectable } from '@angular/core';

import { Observable, throwError } from 'rxjs';

import { IUserDados } from '../../interfaces/iuser-dados';

import { FirestoreQueryService } from '../data-handling/firestore-query.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';

@Injectable({ providedIn: 'root' })
export class UserManagementService {
  constructor(
    private readonly write: FirestoreWriteService,
    private readonly firestoreQuery: FirestoreQueryService,
    private readonly firestoreUserQuery: FirestoreUserQueryService
  ) {}

  getUserById(uid: string) {
    return this.firestoreUserQuery.getUserById(uid);
  }

  getAllUsers(): Observable<IUserDados[]> {
    return this.firestoreQuery.getAllUsers();
  }

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
   * SUPRESSÃO EXPLÍCITA:
   * - removido `deleteUserAccount()`.
   *
   * Motivo:
   * - lifecycle de conta não pertence a este serviço genérico;
   * - a implementação antiga apagava Firestore antes do Auth e podia criar
   *   conta autenticável sem documento privado;
   * - exclusão administrativa exige autorização de staff, auditoria, retenção
   *   e expurgo pelo backend;
   * - os consumidores usam agora `AccountLifecycleService.moderateScheduleDeletion$()`.
   */

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }
}
