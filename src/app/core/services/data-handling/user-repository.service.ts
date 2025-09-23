// src/app/core/services/data-handling/user-repository.service.ts
import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreService } from '@core/services/data-handling/firestore.service';
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { UsuarioService } from '@core/services/user-profile/usuario.service';
import { IUserDados } from '@core/interfaces/iuser-dados';

import { doc, updateDoc, Timestamp } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class UserRepositoryService {
  constructor(
    private fsService: FirestoreService,
    private userQuery: FirestoreUserQueryService,
    private usuarioService: UsuarioService,
  ) { }

  /** Busca o documento do usuário no Firestore (ou null). */
  getUser$(uid: string): Observable<IUserDados | null> {
    if (!uid) return of(null);
    return this.userQuery.getUser(uid);
  }

  /** Atualiza emailVerified no Firestore. */
  setEmailVerified$(uid: string, status: boolean): Observable<void> {
    const fs = this.fsService.getFirestoreInstance();
    const ref = doc(fs, 'users', uid);
    return from(updateDoc(ref, { emailVerified: status })).pipe(map(() => void 0));
  }

  /** Atualiza lastLogin. */
  markLastLogin$(uid: string): Observable<void> {
    const fs = this.fsService.getFirestoreInstance();
    const ref = doc(fs, 'users', uid);
    return from(updateDoc(ref, { lastLogin: Timestamp.fromDate(new Date()) })).pipe(
      catchError(() => of(void 0)), // best-effort
      map(() => void 0)
    );
  }

  /** Marca presença on/off (fallback; PresenceService já mantém batimento). */
  setOnline$(uid: string, online: boolean): Observable<void> {
    const ret = (this.usuarioService as any)?.updateUserOnlineStatus?.(uid, online);
    if (!ret) return of(void 0);
    // Retorna como Observable para uniformidade
    return ret instanceof Observable ? ret : from(Promise.resolve(ret));
  }
}
