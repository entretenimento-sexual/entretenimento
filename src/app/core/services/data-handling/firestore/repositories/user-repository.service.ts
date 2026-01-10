// src/app/core/services/data-handling/user-repository.service.ts
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { serverTimestamp as fsServerTimestamp } from '@angular/fire/firestore';

import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { UsuarioService } from '@core/services/user-profile/usuario.service';
import { IUserDados } from '@core/interfaces/iuser-dados';
import { FirestoreWriteService } from '../core/firestore-write.service';


@Injectable({ providedIn: 'root' })
export class UserRepositoryService {
  constructor(
    private readonly write: FirestoreWriteService,
    private readonly userQuery: FirestoreUserQueryService,
    private readonly usuarioService: UsuarioService
  ) { }

  getUser$(uid: string): Observable<IUserDados | null> {
    if (!uid) return of(null);
    return this.userQuery.getUser(uid);
  }

  setEmailVerified$(uid: string, status: boolean): Observable<void> {
    return this.write.updateDocument('users', uid, { emailVerified: status });
  }

  markLastLogin$(uid: string): Observable<void> {
    // best-effort (não derruba o fluxo)
    return this.write.updateDocument('users', uid, { lastLogin: fsServerTimestamp() }).pipe(
      catchError(() => of(void 0))
    );
  }

  setOnline$(uid: string, online: boolean): Observable<void> {
    const ret = (this.usuarioService as any)?.updateUserOnlineStatus?.(uid, online);
    if (!ret) return of(void 0);
    return ret;
  }
}
