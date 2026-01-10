// src/app/core/services/data-handling/firestore/core/public-index.repository.ts
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';

import { Auth } from '@angular/fire/auth';
import { Timestamp } from '@angular/fire/firestore';

import { FirestoreReadService } from '../core/firestore-read.service';
import { FirestoreWriteService } from '../core/firestore-write.service';
import { FirestoreErrorHandlerService } from '../../../error-handler/firestore-error-handler.service';

@Injectable({ providedIn: 'root' })
export class PublicIndexRepository {
  constructor(
    private readonly read: FirestoreReadService,
    private readonly write: FirestoreWriteService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly auth: Auth
  ) { }

  getPublicNicknameIndex(nickname: string): Observable<any | null> {
    const normalized = nickname.trim().toLowerCase();
    const docId = `nickname:${normalized}`;
    return this.read.getDocument<any>('public_index', docId, { source: 'server' });
  }

  savePublicIndexNickname(nickname: string): Observable<void> {
    const normalized = nickname.trim().toLowerCase();
    const user = this.auth.currentUser;

    if (!user) {
      return throwError(() =>
        Object.assign(new Error('Usuário não autenticado.'), { code: 'auth/not-authenticated' })
      );
    }

    const docId = `nickname:${normalized}`;
    const data = {
      type: 'nickname',
      value: normalized,
      uid: user.uid,
      createdAt: Timestamp.now(),
      lastChangedAt: Timestamp.now(),
    };

    // ✅ create-only via rules (update bloqueado)
    return this.write.setDocument('public_index', docId, data).pipe(
      catchError((err) => this.mapNicknameCreateOnlyError(err, docId))
    );
  }

  updatePublicNickname(oldNickname: string, newNickname: string, isSubscriber: boolean): Observable<void> {
    const user = this.auth.currentUser;

    if (!user) {
      return throwError(() =>
        Object.assign(new Error('Usuário não autenticado.'), { code: 'auth/not-authenticated' })
      );
    }
    if (!isSubscriber) {
      return throwError(() =>
        Object.assign(new Error('Mudança de apelido restrita a assinantes.'), { code: 'subscription/required' })
      );
    }

    const oldN = oldNickname.trim().toLowerCase();
    const newN = newNickname.trim().toLowerCase();

    const oldDocId = `nickname:${oldN}`;
    const newDocId = `nickname:${newN}`;

    const data = {
      type: 'nickname',
      value: newN,
      uid: user.uid,
      createdAt: Timestamp.now(),
      lastChangedAt: Timestamp.now(),
    };

    // Ordem segura: cria o novo -> apaga o antigo
    return this.read.getDocument<any>('public_index', newDocId, { source: 'server' }).pipe(
      take(1),
      switchMap((exists) => {
        if (exists) {
          return throwError(() => Object.assign(new Error('Apelido já está em uso.'), { code: 'nickname/in-use' }));
        }

        return this.write.setDocument('public_index', newDocId, data).pipe(
          catchError((err) => this.mapNicknameCreateOnlyError(err, newDocId)),
          switchMap(() => this.write.deleteDocument('public_index', oldDocId))
        );
      })
    );
  }

  private mapNicknameCreateOnlyError(err: any, docId: string): Observable<never> {
    const code = err?.code ?? err?.name ?? '';

    // quando o doc existe, setDoc vira "update" e a regra nega => permission-denied
    const maybeConflict =
      code === 'permission-denied' ||
      code === 'PERMISSION_DENIED' ||
      String(code).includes('permission');

    if (!maybeConflict) {
      return this.firestoreError.handleFirestoreError(err);
    }

    // ✅ confirma no server: se existe => nickname em uso
    return this.read.getDocument<any>('public_index', docId, { source: 'server' }).pipe(
      take(1),
      switchMap((doc) => {
        if (doc) {
          return throwError(() => Object.assign(new Error('Apelido já está em uso.'), { code: 'nickname/in-use' }));
        }
        return this.firestoreError.handleFirestoreError(err);
      })
    );
  }
}
