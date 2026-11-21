// src/app/core/services/data-handling/firestore-user-write.service.ts
import { Injectable } from '@angular/core';

import {
  Firestore,
  doc,
} from '@angular/fire/firestore';

import {
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import type { IUserDados } from '@core/interfaces/iuser-dados';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { FirestoreContextService } from './firestore/core/firestore-context.service';

@Injectable({ providedIn: 'root' })
export class FirestoreUserWriteService {
  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  patchLastLogin$(uid: string): Observable<void> {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      return of(void 0);
    }

    const ref = this.ctx.run(() => doc(this.db, 'users', safeUid));

    return this.ctx
      .deferPromise$(() =>
        updateDoc(ref, { lastLogin: serverTimestamp() })
      )
      .pipe(
        map(() => void 0),
        catchError((err) => {
          this.safeHandle(
            '[FirestoreUserWriteService] patchLastLogin falhou (ignorado).',
            err,
            { uid: safeUid },
            { silent: true }
          );

          return of(void 0);
        })
      );
  }

  patchEmailVerified$(uid: string, status: boolean): Observable<void> {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('[FirestoreUserWriteService] UID inválido.'));
    }

    const ref = this.ctx.run(() => doc(this.db, 'users', safeUid));

    return this.ctx
      .deferPromise$(() =>
        updateDoc(ref as any, {
          emailVerified: status === true,
        } as any)
      )
      .pipe(map(() => void 0));
  }

  saveUserDataAfterEmailVerification$(user: IUserDados): Observable<void> {
    if (!user?.uid) {
      return throwError(() => new Error('UID do usuário não definido.'));
    }

    return this.patchEmailVerified$(user.uid, true).pipe(
      catchError((err) => {
        this.safeHandle(
          '[FirestoreUserWriteService] saveUserDataAfterEmailVerification falhou.',
          err,
          { uid: user.uid },
          { silent: false }
        );

        return throwError(() => err);
      })
    );
  }

  private safeHandle(
    msg: string,
    original: unknown,
    meta?: Record<string, unknown>,
    opts?: { silent?: boolean }
  ): void {
    try {
      const e = new Error(msg);

      (e as any).original = original;
      (e as any).meta = meta;

      const silent = opts?.silent === true;
      (e as any).silent = silent;

      if (silent) {
        (e as any).skipUserNotification = true;
      }

      this.globalErrorHandler.handleError(e);
    } catch {
      // noop
    }
  }
}
